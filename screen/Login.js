// Libraries
import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

// Analytics
import analytics from '@react-native-firebase/analytics';

// Components
import {
  Alert,
  Image,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useLinkTo } from '@react-navigation/native';
import {
  Button,
  TextInput,
  PageContainer,
  AcceptTermsToggle,
  ScaledText,
} from '../../../components';

// Helpers
import {
  login,
  selectClient,
  reset,
  logout,
  deselectDeepLink,
} from '../../../actions';

import { baseScale, scaleHeight, curvedScale } from '../../../util/responsive';

import { ROLES, passwordRecoveryUAURL } from '../../../constants';
import { API_VERSION } from '../../../api/nasm_sdk/constants';
import * as db from '../../../dataManager';
import nasm from '../../../dataManager/apiConfig';
import * as validate from '../../../util/validate'
const DeviceInfo = require('react-native-device-info');
import {setUserProp, track} from "../../../util/Analytics";
import subscriptionLevels from "../../../util/subscriptionLevels";

// Styles
import { colors } from '../../../styles';

// Images
const smallUnchecked = require('../../../resources/checkmarkWhiteUnselected.png');
const smallChecked = require('../../../resources/checkmarkGreenSelected.png');

const smallCheckedWidth = curvedScale(
  Image.resolveAssetSource(smallChecked).width,
);
const smallCheckedHeight = curvedScale(
  Image.resolveAssetSource(smallChecked).height,
);

// PropTypes
const propTypes = {
  login: PropTypes.func.isRequired,
  logout: PropTypes.func.isRequired,
  selectClient: PropTypes.func.isRequired,
  navigation: PropTypes.shape({
    navigate: PropTypes.func,
  }).isRequired,
  deepLink: PropTypes.object,
  deselectDeepLink: PropTypes.func,
};

const defaultProps = {
  loginPreferences: { rememberMe: false },
};

// (L) - Login
class Login extends Component {
  static navigationOptions = {
    headerTransparent: true,
    title: null,
  };

  constructor(props) {
    super(props);
    const email = props.route.params?.email;
    const hasEdgeAccount = props.route.params?.hasEdgeAccount;
    const hasUAAccount = props.route.params?.hasUAAccount;
    const uaAccountInEDGE = props.route.params?.uaAccountInEDGE;
    const edgeAccountInUA = props.route.params?.edgeAccountInUA;
    const edgeUserRole = props.route.params?.edgeUserRole;

    let loginType;

    if (edgeUserRole === 'CLIENT') {
      loginType = LOGIN_TYPES.CLIENT_LOGIN;
    } else if (hasUAAccount && uaAccountInEDGE) {
      loginType = LOGIN_TYPES.UA_LOGIN;
    } else if (hasUAAccount && !uaAccountInEDGE && !hasEdgeAccount) {
      loginType = LOGIN_TYPES.UA_REGISTRATION;
    } else if (!hasUAAccount && hasEdgeAccount && !edgeAccountInUA) {
      loginType = LOGIN_TYPES.UA_MIGRATION;
    } else if (
      hasUAAccount
      && hasEdgeAccount
      && !uaAccountInEDGE
      && !edgeAccountInUA
    ) {
      loginType = LOGIN_TYPES.UA_LINK;
    } else {
      Alert.alert('Error', 'Something whent wrong, please try again.');
      props.navigation.goBack();
    }

    this.state = {
      rememberMe: props.route.params?.rememberMe,
      email,
      password: '',
      validationPassed: false,
      isLoading: false,
      title:
        loginType === LOGIN_TYPES.UA_LOGIN
        || loginType === LOGIN_TYPES.UA_REGISTRATION
          ? 'Enter your NASM password'
          : 'Enter password',
      message: email,
      oneLineMessage: true,
      resettingPassword: false,
      loginType,
      termsAccepted: false,
      versionNumber: DeviceInfo.getVersion(),
    };
  }

  componentDidMount = () => {
    this.unsubscribeFocus = this.props.navigation.addListener('focus', () => {
      StatusBar.setBarStyle('light-content');
      analytics().logEvent('screen_view', { screen_name: 'login' });
    });
  };

  componentWillUnmount() {
    this.unsubscribeFocus();
  }

  onPressForgotPassword = () => {
    if (
      this.state.loginType === LOGIN_TYPES.UA_MIGRATION
      || this.state.loginType === LOGIN_TYPES.UA_LINK
      || this.state.loginType === LOGIN_TYPES.CLIENT_LOGIN
    ) {
      Alert.alert(
        'Reset Password?',
        "You'll receive an email to reset your password.",
        [
          {
            text: 'Cancel',
          },
          {
            text: 'Confirm',
            onPress: this.resetPassword,
          },
        ],
      );
    } else {
      passwordRecoveryUAURL().then((UAURL) => {
        this.props.navigation.navigate('WebView', {
          title: 'NASM.ORG',
          uri: UAURL,
        });
      });
    }
  };

  onPressLogin = () => {
    switch (this.state.loginType) {
      case LOGIN_TYPES.CLIENT_LOGIN:
        this.login(null, 'v1.7');
        break;

      case LOGIN_TYPES.UA_LOGIN:
        this.login();
        break;

      case LOGIN_TYPES.UA_MIGRATION:
        this.verifyEdgePassword();
        break;

      case LOGIN_TYPES.UA_REGISTRATION:
        this.createAccountWithUA();
        break;

      case LOGIN_TYPES.UA_LINK:
        this.verifyEdgePassword();
        break;

      default:
        break;
    }
  };

  createAccountWithUA = () => {
    if (!this.state.termsAccepted) {
      Alert.alert('Please accept our terms and conditions and privacy policy.');
      return;
    }
    this.setState({ isLoading: true }, () => {
      const { email, password } = this.state;
      nasm.api
        .registerTrainerWithUAAccount(email, password, true)
        .then(() => {
          this.login(true);
        })
        .catch((error) => {
          this.setState(
            { isLoading: false, password: '', validationPassed: false },
            () => {
              this.handleAuthError(error);
            },
          );
        });
    });
  };

  createNewUAAccount = async () => {
    const { email, password } = this.state;
    try {
      await nasm.api.migrateEdgeAccountToUA(email, password);
      const loggedInUser = await this.props.login({ email, password });
      db.updateLoginPreferences(this.state.rememberMe, email).catch(() => {});
      nasm.api
        .checkTerms()
        .then(({ requires_pp_update, requires_tc_update }) => {
          if (requires_tc_update) {
            // display new terms
            this.props.navigation.navigate('TermsAndConditions', {
              updatePrivacy: requires_pp_update,
              navWhenDone: (navigation) => {
                this.handleLoggedInUser(loggedInUser, null, navigation);
              },
            });
          } else if (requires_pp_update) {
            this.props.navigation.navigate('PrivacyPolicy', {
              navWhenDone: (navigation) => {
                this.handleLoggedInUser(loggedInUser, null, navigation);
              },
            });
          } else {
            this.handleLoggedInUser(loggedInUser);
          }
        });
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      this.setState({ isLoading: false });
    }
  };

  focusInput = (input) => {
    const target = this.inputRefs[input];
    if (target && target.textInput) target.textInput.focus();
  };

  handleAuthError = (error) => {
    try {
      if (typeof error.response.data.message === 'object') {
        const errorData = error.response.data.message;
        if (errorData.description) {
          this.setState({
            title: errorData.title,
            message: errorData.description,
            oneLineMessage: false,
          });
        } else {
          this.setState({
            title: errorData.title,
          });
        }
      } else {
        Alert.alert('Error', error.response.data.message);
      }
    } catch (e) {
      Alert.alert('Error', error.message);
    }
  };

  handleLoggedInUser = (user, uaRegistration, navigation) => {
    if (uaRegistration) {
      analytics().logEvent('ua_signup', {
        email: this.state.email,
        user_role: 'trainer',
      });
    }
    this.setState(
      {
        isLoading: false,
      },
      () => {
        setUserProp('LevelOfSubscription', subscriptionLevels(user));
        if (user.role === ROLES.TRAINER) {
          analytics().logEvent('login', { user_role: 'trainer' });
          analytics().setUserProperty('role', 'trainer');

          if (this.props.deepLink) {
            this.props.linkTo(this.props.deepLink);
            this.props.deselectDeepLink();
          } else {
            reset(navigation, 'ModalStack', null, null);
          }
        } else {
          const walkIn = this.isWalkinClient(user);
          analytics().logEvent('login', {
            user_role: walkIn ? 'walk_in' : 'client',
          });
          analytics().setUserProperty('role', walkIn ? 'walk_in' : 'client');
          this.props.selectClient(user);

          // Navigate
          if (this.props.deepLink) {
            this.props.linkTo(this.props.deepLink);
            this.props.deselectDeepLink();
          } else {
            reset(navigation, 'ModalStack', null, null);
          }
        }
      },
    );
  };

  isWalkinClient = (user) => {
    if (user.role === ROLES.CLIENT) {
      return !user.client_user.trainer;
    }
    return false;
  };

  login = (uaRegistration, version = API_VERSION) => {
    const { email, password, rememberMe } = this.state;
    this.setState(
      {
        isLoading: true,
      },
      () => {
        this.props
          .login({ email, password, version })
          .then((loggedInUser) => {
            db.updateLoginPreferences(rememberMe, email).catch(() => {});
            return nasm.api
              .checkTerms()
              .then(({ requires_pp_update, requires_tc_update }) => {
                if (requires_tc_update) {
                  // display new terms
                  this.props.navigation.navigate('TermsAndConditions', {
                    updatePrivacy: requires_pp_update,
                    navWhenDone: (navigation) => {
                      this.handleLoggedInUser(
                        loggedInUser,
                        uaRegistration,
                        navigation,
                      );
                    },
                  });
                } else if (requires_pp_update) {
                  this.props.navigation.navigate('PrivacyPolicy', {
                    navWhenDone: (navigation) => {
                      this.handleLoggedInUser(
                        loggedInUser,
                        uaRegistration,
                        navigation,
                      );
                    },
                  });
                } else {
                  this.handleLoggedInUser(
                    loggedInUser,
                    uaRegistration,
                    this.props.navigation,
                  );
                }
              });
          })
          .catch((error) => {
            this.setState(
              { isLoading: false, password: '', validationPassed: false },
              () => {
                this.handleAuthError(error);
              },
            );
          });
      },
    );
  };

  resetPassword = () => {
    this.setState({ resettingPassword: true }, () => {
      nasm.api
        .createPasswordResetRequest(this.state.email)
        .then(() => {
          this.setState({
            title: 'Password Reset',
            message: 'Check your email for further instructions',
            oneLineMessage: false,
          });
        })
        .catch((error) => {
          Alert.alert('Error', error.message);
        })
        .finally(() => {
          this.setState({ resettingPassword: false });
        });
    });
  };

  updateInput = (nextState) => {
    this.setState(nextState, this.validateInputs);
  };

  validateInputs = () => {
    const validationPassed = this.state.password.length > 0;
    this.setState({ validationPassed });
    return validationPassed;
  };

  verifyEdgePassword = () => {
    this.setState(
      {
        isLoading: true,
      },
      async () => {
        try {
          const passwordVerified = await nasm.api.verifyEdgeCredentials(
            this.state.email,
            this.state.password,
          );
          if (passwordVerified) {
            // password is correct
            if (this.state.loginType === LOGIN_TYPES.UA_MIGRATION) {
              if (validate.password(this.state.password)) {
                // password matches ua requirements
                this.createNewUAAccount();
              } else {
                // user must update their password
                this.setState({ isLoading: false }, () => {
                  this.props.navigation.navigate('ChangePassword', {
                    email: this.state.email,
                    password: this.state.password,
                    rememberMe: this.state.rememberMe,
                  });
                });
              }
            } else {
              this.props.navigation.navigate('LinkAccount', {
                email: this.state.email,
                rememberMe: this.state.rememberMe,
              });
            }
          } else {
            this.setState({
              isLoading: false,
              title: 'Try again',
              message: 'Please enter the password used for your EDGE account',
              oneLineMessage: false,
              password: '',
              validationPassed: false,
            });
          }
        } catch (error) {
          this.setState({
            isLoading: false,
            title: 'Try again',
            message: 'Please enter the password used for your EDGE account',
            oneLineMessage: false,
            password: '',
            validationPassed: false,
          });
        }
      },
    );
  };

  render() {
    const isLoginDisabled = !this.state.validationPassed
      || (this.state.loginType === LOGIN_TYPES.UA_REGISTRATION
        && !this.state.termsAccepted);
    return (
      <PageContainer
        containerStyle={styles.pageContainerStyle}
        testID="LoginScreen"
      >
        {/* Enter Password Block */}
        <View style={styles.titleContainer}>
          <ScaledText
            style={
              this.state.title === 'Incorrect Password'
                ? styles.errorTitle
                : styles.title
            }
          >
            {this.state.title}
          </ScaledText>
          <ScaledText
            style={styles.email}
            ellipsizeMode="tail"
            numberOfLines={this.state.oneLineMessage ? 1 : undefined}
          >
            {this.state.message}
          </ScaledText>
        </View>
        <View style={styles.passwordFormContainer}>
          <TextInput
            value={this.state.password}
            onChangeText={(password) => this.updateInput({ password })}
            placeholder="Password"
            placeholderTextColor={colors.white}
            secureTextEntry
            showIcon={false}
            returnKeyType="done"
            validation={(value) => !!value}
            containerStyle={styles.inputContainerStyle}
            inputText={styles.inputTextStyle}
            selectionColor={colors.white}
            testID="PasswordTextInput"
            onSubmitEditing={this.onPressLogin}
          />
          <View style={styles.forgotPasswordContainer}>
            <TouchableOpacity
              style={styles.forgotPasswordButton}
              onPress={this.onPressForgotPassword}
            >
              <ScaledText
                style={[
                  styles.forgotPasswordText,
                  this.state.resettingPassword && { color: 'transparent' },
                ]}
              >
                Forgot Password
              </ScaledText>
            </TouchableOpacity>
            {this.state.resettingPassword && (
              <ActivityIndicator
                style={styles.activityIndicator}
                color={colors.white}
              />
            )}
          </View>
        </View>
        {/* Login Button Block */}
        <View style={styles.loginButtonContainer}>
          {this.state.loginType !== LOGIN_TYPES.UA_REGISTRATION && (
            <TouchableOpacity
              style={styles.rememberMeContainer}
              onPress={() => this.setState({ rememberMe: !this.state.rememberMe })}
              testID="RememberMeButton"
            >
              <Image
                style={{ width: smallCheckedWidth, height: smallCheckedHeight }}
                source={this.state.rememberMe ? smallChecked : smallUnchecked}
              />
              <ScaledText style={styles.rememberMeText}>
                Remember My Login Info
              </ScaledText>
            </TouchableOpacity>
          )}
          {this.state.loginType === LOGIN_TYPES.UA_REGISTRATION && (
            <AcceptTermsToggle
              navigation={this.props.navigation}
              termsAccepted={this.state.termsAccepted}
              onToggleChanged={(termsAccepted) => this.setState({ termsAccepted })}
              textStyle={{ color: colors.white }}
              linkStyle={{
                color: colors.white,
                textDecorationLine: 'underline',
              }}
            />
          )}
          <Button
            title="Login"
            onPress={this.onPressLogin}
            disabled={isLoginDisabled}
            isLoading={this.state.isLoading}
            testID="SubmitLoginButton"
            containerStyle={[
              styles.loginButton,
              {
                backgroundColor: isLoginDisabled
                  ? 'rgba(37, 146, 236, 0.25)'
                  : colors.azure,
              },
            ]}
          />
          <ScaledText
            style={
              styles.versionText
            }
          >
            {`v${this.state.versionNumber}`}
          </ScaledText>
        </View>
      </PageContainer>
    );
  }
}

// Styles
const styles = StyleSheet.create({
  pageContainerStyle: {
    flex: 1,
    backgroundColor: colors.duskBlue,
    justifyContent: 'space-evenly',
    paddingHorizontal: '10%',
  },
  titleContainer: {
    marginTop: scaleHeight(10),
  },
  passwordFormContainer: {},
  inputContainerStyle: {
    borderColor: colors.white,
    paddingHorizontal: 0,
  },
  inputTextStyle: {
    color: colors.white,
  },
  forgotPasswordContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  forgotPasswordButton: {
    // add padding to make the button easier to press
    paddingLeft: baseScale(30),
  },
  forgotPasswordText: {
    fontSize: 14,
    color: colors.white,
    letterSpacing: 0,
    fontFamily: 'Avenir-Roman',
  },
  rememberMeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  rememberMeText: {
    fontFamily: 'Avenir-Heavy',
    fontSize: 14,
    color: colors.white,
    marginLeft: baseScale(8),
  },
  loginButtonContainer: {},
  loginButton: {
    alignSelf: 'center',
    borderRadius: scaleHeight(3),
    borderWidth: 0,
    width: '100%',
    height: scaleHeight(6),
    marginVertical: baseScale(40),
  },
  title: {
    fontFamily: 'Avenir',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    color: colors.white,
  },
  errorTitle: {
    fontFamily: 'Avenir',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    color: colors.medYellow,
  },
  email: {
    fontFamily: 'Avenir',
    fontSize: 18,
    textAlign: 'center',
    color: colors.white,
    marginTop: curvedScale(20),
  },
  headerText: {
    fontFamily: 'Avenir',
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.white,
  },
  versionText: {
    fontFamily: 'Avenir-Roman',
    fontSize: 11,
    textAlign: 'left',
    color: colors.white,
    alignSelf: 'center',
  },
  activityIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
// Export
Login.propTypes = propTypes;
Login.defaultProps = defaultProps;
const mapStateToProps = ({ loginPreferences, User }) => ({
  loginPreferences,
  User,
});
const mapDispatchToProps = {
  login, selectClient, logout, deselectDeepLink,
};
const ConnectedComponent = connect(mapStateToProps, mapDispatchToProps)(Login);

const functionComponent = function (props) {
  const linkTo = useLinkTo();
  return <ConnectedComponent {...props} linkTo={linkTo} />;
};
functionComponent.navigationOptions = Login.navigationOptions;
export default functionComponent;

const LOGIN_TYPES = {
  UA_LOGIN: 0,
  UA_MIGRATION: 1,
  UA_REGISTRATION: 2,
  UA_LINK: 3,
  CLIENT_LOGIN: 4,
};
