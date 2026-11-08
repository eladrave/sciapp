// Clerk publishes its browser SDK from the frontend API encoded in the public key.
let loading;
async function initialize(config) {
  if (!config?.clerkPublishableKey) return;
  if (loading) return loading;
  loading = (async () => {
    const key = config.clerkPublishableKey;
    const prefix = key.match(/^pk_(test|live)_/);
    if (!prefix) throw new Error('The sign-in configuration is invalid.');
    const encoded = key.slice(prefix[0].length).replace(/-/g, '+').replace(/_/g, '/');
    const frontend = atob(encoded).replace(/\$$/, '');
    if (!/^[a-zA-Z0-9.-]+$/.test(frontend)) throw new Error('The sign-in configuration is invalid.');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.clerkPublishableKey = key;
      script.src = `https://${frontend}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Sign-in could not load. Check your connection and try again.'));
      document.head.append(script);
    });
    if (!window.Clerk) throw new Error('Sign-in could not initialize.');
    await window.Clerk.load();
    let activeSession = null;
    window.Clerk.addListener(({ session }) => {
      const sessionId = session?.id || null;
      if (sessionId === activeSession) return;
      activeSession = sessionId;
      window.dispatchEvent(new CustomEvent(sessionId ? 'sciapp:signed-in' : 'sciapp:signed-out'));
    });
    window.dispatchEvent(new CustomEvent('sciapp:auth-ready'));
  })();
  try { await loading; } catch (error) {
    loading = null;
    window.dispatchEvent(new CustomEvent('sciapp:auth-error', { detail: { message: error.message } }));
    throw error;
  }
}
window.sciappSignIn = async () => {
  try {
    await loading;
    if (!window.Clerk?.loaded) throw new Error('Sign-in is still loading. Try again in a moment.');
    window.Clerk.openSignIn();
  } catch (error) {
    window.dispatchEvent(new CustomEvent('sciapp:auth-error', { detail: { message: error.message } }));
  }
};
window.sciappSignOut = async () => {
  if (window.Clerk?.session) await window.Clerk.signOut();
};
window.addEventListener('sciapp:auth-config', event => { initialize(event.detail).catch(() => {}); });
