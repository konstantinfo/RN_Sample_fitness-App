// @flow

import type { User } from '../types/User';
import {
  LOGIN,
  LOGOUT,
  UPDATE_CURRENT_USER,
} from '../actions/currentUserActions';

type State = User | null;

export default function (state: State = null, action: any) {
  switch (action.type) {
    case LOGIN: {
      return action.payload;
    }
    case LOGOUT: {
      return { isLoggedOut: false };
    }
    case UPDATE_CURRENT_USER: {
      return { ...action.payload };
    }
    default: {
      return state;
    }
  }
}
