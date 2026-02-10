
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

export type AppState = 'dashboard' | 'loading' | 'generated' | 'deploying';
