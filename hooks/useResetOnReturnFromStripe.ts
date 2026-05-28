import { useEffect, useRef } from 'react';

// Resets the publish/deploy button's loading state when the user comes
// back from Stripe Checkout without completing payment.
//
// The bug: we set isDeploying=true and then immediately call
// window.location.href = stripeCheckoutUrl. If the user closes Stripe or
// taps the back button, Safari/Chrome restores the page from bfcache —
// React state is preserved as-is, so the Publish button stays stuck in
// its loading spinner forever.
//
// The fix: listen for two signals and reset:
//   1. pageshow with event.persisted === true → page restored from
//      bfcache, definitely a back-button return
//   2. visibilitychange → visible after we set the "redirected" flag
//      → user came back from the Stripe tab without bfcache
//
// Returns a `markRedirecting()` helper to call right before the
// window.location.href assignment, so the visibility handler knows it
// should reset (and doesn't fire on every random tab switch).
export function useResetOnReturnFromStripe(reset: () => void) {
  const redirectingRef = useRef(false);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      // bfcache restore — reset unconditionally. If isDeploying was
      // false this is a no-op for the parent.
      if (e.persisted) {
        redirectingRef.current = false;
        reset();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && redirectingRef.current) {
        redirectingRef.current = false;
        reset();
      }
    };

    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reset]);

  return {
    markRedirecting: () => {
      redirectingRef.current = true;
    },
  };
}
