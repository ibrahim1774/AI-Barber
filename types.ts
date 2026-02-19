
export interface ShopInputs {
  shopName: string;
  area: string;
  phone: string;
}

export interface ServiceItem {
  title: string;
  subtitle: string;
  description: string;
  icon: 'scissors' | 'razor' | 'mustache' | 'face';
  imageUrl: string;
}

export interface WebsiteData {
  shopName: string;
  area: string;
  phone: string;
  hero: {
    heading: string;
    tagline: string;
    imageUrl: string;
  };
  about: {
    heading: string;
    description: string[];
    imageUrl: string;
  };
  services: ServiceItem[];
  gallery: string[];
  contact: {
    address: string;
    email: string;
  };
}

/** Wraps WebsiteData with persistence and deployment metadata */
export interface SiteInstance {
  id: string;
  data: WebsiteData;
  lastSaved: number;
  formInputs: ShopInputs;
  deployedUrl: string | null;
  deploymentStatus: 'draft' | 'deployed' | 'deploying' | 'failed';
  customDomain: string | null;
  domainOrderId: string | null;
}

/** Supabase user profile (mirrors users_profile table) */
export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  subscription_status: 'none' | 'active' | 'past_due' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AppState = 'generator' | 'loading' | 'editor' | 'deploying' | 'dashboard';
