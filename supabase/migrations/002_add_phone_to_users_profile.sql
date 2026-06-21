-- Capture the account holder's phone number collected at signup.
-- The phone is passed in signUp() metadata (raw_user_meta_data->>'phone');
-- this adds the column and updates the signup trigger to persist it.

ALTER TABLE public.users_profile ADD COLUMN IF NOT EXISTS phone TEXT;

-- Recreate the signup trigger function so new accounts also write phone.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users_profile (id, email, full_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
