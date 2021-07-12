// Imports
import { Platform, Alert } from 'react-native';
import analytics from '@react-native-firebase/analytics';
import OneSignal from 'react-native-onesignal';
import * as Sentry from '@sentry/react-native';
import DeviceInfo from 'react-native-device-info';
import moment from 'moment';
import { API_VERSION } from '../api/nasm_sdk/constants';
import { chatClient, FEATURE_FLAGS, ROLES } from '../constants';
import {setUser, setUserProp, track, flushMixpanel, resetMixpanel} from "../util/Analytics";
import nasm from '../dataManager/apiConfig';
import * as db from '../dataManager';
import subscriptionLevels from "../util/subscriptionLevels";

export const LOGIN = 'LOGIN';
export const LOGOUT = 'LOGOUT';
export const UPDATE_CURRENT_USER = 'UPDATE_CURRENT_USER';

/**
 * Log a user in with email and password
 * @param {Object} user - User login credentials
 * @param user.email {String} Email of user to login
 * @param user.password {String} Password of user to login
 */
export function login({ email, password, version = API_VERSION }) {
  return async (dispatch) => {
    // Login and get the current user
    const currentUser = await db.login({ email, password }, version);
    // Dispatch the result to redux
    dispatch({
      type: LOGIN,
      payload: currentUser,
    });
    // set id for analytics
    analytics().setUserProperty('id', '' + currentUser.id);
    await setUser(currentUser.id);
    await setUserProp('Email', currentUser.email);
    await setUserProp('Role', currentUser.nasm_role);
    if (currentUser.role === ROLES.TRAINER) {
      await setUserProp(
        'active_subscriptions',
        moment()
          .isSameOrBefore(currentUser.subscription_expiration_date)
          .toString(),
      );
      await setUserProp(
        'Purchases',
        (!!currentUser.purchased_product_ids?.length).toString(),
      );
    }
    setUserProp('LevelOfSubscription', subscriptionLevels(currentUser));
    track('test_event_login');

    Sentry.configureScope((scope) => {
      scope.setUser({
        email,
        id: currentUser.id,
      });
    });
    if (FEATURE_FLAGS.CHAT_ENABLED) {
      await loginToChat(currentUser);
    }
    // Return the result for immediate inspection if necessary
    return currentUser;
  };
}

export function relogin(version = API_VERSION) {
  return async (dispatch) => {
    // Login and get the current user
    try {
      const currentUser = await db.relogin(version);
      // Dispatch the result to redux
      dispatch({
        type: LOGIN,
        payload: currentUser,
      });
      // set id for analytics
      analytics().setUserProperty('id', '' + currentUser.id);
      await setUser(currentUser.id);
      await setUserProp('Email', currentUser.email);
      await setUserProp('Role', currentUser.nasm_role);
      if (currentUser.role === ROLES.TRAINER) {
        await setUserProp(
          'active_subscriptions',
          (!!currentUser.in_app_purchases?.length).toString(),
        );
      }
      Sentry.configureScope((scope) => {
        scope.setUser({
          email: currentUser.email,
          id: currentUser.id,
        });
      });
      if (FEATURE_FLAGS.CHAT_ENABLED) {
        await loginToChat(currentUser);
      }
      // Return the result for immediate inspection if necessary
      return currentUser;
    } catch (error) {
      return false;
    }
  };
}

function getDeviceData(token, oneSignalId) {
  return {
    token,
    player_id: oneSignalId,
    platform: Platform.OS,
    brand: DeviceInfo.getBrand(),
    model: DeviceInfo.getModel(),
    sys_version: DeviceInfo.getSystemVersion(),
    app_version: DeviceInfo.getVersion(),
    build_numbe: DeviceInfo.getBuildNumber(),
    user_agent: DeviceInfo.getUserAgentSync(),
    bundleId: DeviceInfo.getBundleId(),
    android_api_level: DeviceInfo.getApiLevelSync(),
    device_uuid: DeviceInfo.getUniqueId(),
  };
}

export function registerForPush(userId, role, extraTags = null) {
  return async () => {
    const isEmulator = await DeviceInfo.isEmulator();
    if (isEmulator) return;

    if (Platform.OS === 'ios') {
      OneSignal.registerForPushNotifications();
    }

    OneSignal.setSubscription(true);
    let tags = {
      user_id: userId,
      user_type: role,
      app_version: DeviceInfo.getVersion(),
    };
    if (extraTags && typeof extraTags === 'object') {
      tags = { ...tags, ...extraTags };
    }
    OneSignal.sendTags(tags);
    OneSignal.setExternalUserId(userId);

    OneSignal.getPermissionSubscriptionState((status) => {
      const { pushToken } = status;
      if (!pushToken) return;
      nasm.api.registerForPush(getDeviceData(pushToken, status.userId));
      if (FEATURE_FLAGS.CHAT_ENABLED) {
        chatClient.addDevice(
          pushToken,
          Platform.OS === 'ios' ? 'apn' : 'firebase',
        );
      }
    });
  };
}

function unregisterFromPush() {
  OneSignal.setSubscription(false);
  OneSignal.deleteTag('user_id');
  OneSignal.deleteTag('user_type');
  OneSignal.removeExternalUserId();
}

async function loginToChat(currentUser) {
  if (chatClient.user) {
    if (chatClient.user.id === currentUser.id) {
      return null;
    }
    chatClient.disconnect();
  }
  let defaultAvatarImageURL;
  if (!currentUser.avatar_url) defaultAvatarImageURL = await nasm.api.getDefaultAvatarImageUrl();
  const imageURL = currentUser.avatar_url
    ? currentUser.avatar_url
    : defaultAvatarImageURL;
  const user = {
    id: currentUser.id,
    name: currentUser.full_name,
    image: imageURL,
  };
  return nasm.api
    .getChatToken()
    .then((tokenResponse) => {
      if (tokenResponse && tokenResponse['chat-token']) {
        return chatClient.setUser(user, tokenResponse['chat-token']);
      }
      Alert.alert('Error connecting to chat', 'Did not receive token');
      return null;
    })
    .catch((error) => {
      Alert.alert('Error connecting to chat', error.message);
    });
}

/**
 * Update a current user in with email and password
 * @param {Object} user - Complete user object
 */
export function updateCurrentUser(user) {
  // Return the result for immediate inspection if necessary
  return {
    type: UPDATE_CURRENT_USER,
    payload: user,
  };
}

export function logout() {
  return async (dispatch) => {
    flushMixpanel();
    resetMixpanel();
    const logoutSuccessful = await db.logout();
    if (FEATURE_FLAGS.CHAT_ENABLED) {
      chatClient.disconnect();
    }
    unregisterFromPush();
    Sentry.configureScope((scope) => {
      scope.setUser(null);
    });
    dispatch({
      type: LOGOUT,
      payload: logoutSuccessful,
    });
    return logoutSuccessful;
  };
}
