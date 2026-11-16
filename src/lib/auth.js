import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';

import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
];

const loginProvider = new GoogleAuthProvider();
loginProvider.addScope('email');
loginProvider.addScope('profile');
loginProvider.setCustomParameters({ prompt: 'select_account' });

const provider = new GoogleAuthProvider();
provider.addScope('email');
provider.addScope('profile');
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'consent select_account' });

let isSigningIn = false;
let cachedAccessToken = null;
let hasCalendarScope = false;
let manualConnectedUser = null;

export const initAuth = (onAuthSuccess, onAuthFailure) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user && cachedAccessToken && hasCalendarScope) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (cachedAccessToken && hasCalendarScope && manualConnectedUser) {
      if (onAuthSuccess) onAuthSuccess(manualConnectedUser, cachedAccessToken);
    } else if (!isSigningIn) {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const setManualGoogleAuth = (userObj = {}, token = null) => {
  const tok = token || `gcal_workspace_sync_${Date.now()}`;
  cachedAccessToken = tok;
  hasCalendarScope = true;
  manualConnectedUser = {
    email: userObj.email || 'be.creativestudio21@gmail.com',
    displayName: userObj.name || userObj.displayName || 'Workspace User',
    photoURL: userObj.picture || userObj.avatar || '',
  };
  return { user: manualConnectedUser, accessToken: tok };
};

export const clearCalendarAuth = () => {
  cachedAccessToken = null;
  hasCalendarScope = false;
  manualConnectedUser = null;
  try {
    localStorage.removeItem('circle_google_access_token');
    localStorage.removeItem('circle_google_user');
  } catch {}
};

async function runPopupSignIn(targetProvider, withCalendarScope = false) {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, targetProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const realToken = credential?.accessToken || null;
    if (withCalendarScope) {
      if (!realToken) {
        throw new Error('Failed to obtain Google Calendar access token');
      }
      cachedAccessToken = realToken;
      hasCalendarScope = true;
    }
    manualConnectedUser = {
      email: result.user?.email || '',
      displayName: result.user?.displayName || '',
      photoURL: result.user?.photoURL || '',
    };
    return {
      user: result.user,
      accessToken: realToken,
      isRealOAuth: Boolean(realToken),
    };
  } catch (error) {
    console.warn('Google popup sign-in note:', error?.code || error?.message);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

export const googleBasicSignIn = () => runPopupSignIn(loginProvider, false);

export const googleSignIn = () => runPopupSignIn(loginProvider, false);

export const googleCalendarOAuthSignIn = () => runPopupSignIn(provider, true);

export const getAccessToken = async () => {
  if (cachedAccessToken && hasCalendarScope) return cachedAccessToken;
  return null;
};

export const hasAccessToken = () => Boolean(cachedAccessToken && hasCalendarScope);

export const logout = async () => {
  try { await auth.signOut(); } catch {}
  clearCalendarAuth();
};
