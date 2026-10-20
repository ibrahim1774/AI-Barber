-- iOS in-app purchases (App Store subscriptions) that entitle a published site.
-- Keyed by Apple's originalTransactionId. Written only by the server (service role).

CREATE TABLE public.ios_purchases (
  original_transaction_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  site_slug TEXT UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_notification TEXT,
  published_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on with no policies: only the service role (which bypasses RLS) can access.
ALTER TABLE public.ios_purchases ENABLE ROW LEVEL SECURITY;
