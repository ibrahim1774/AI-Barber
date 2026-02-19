import { supabase } from '../lib/supabase';
import { SiteInstance, UserProfile } from '../types';

export async function upsertSiteToSupabase(site: SiteInstance, userId: string): Promise<void> {
  const { error } = await supabase.from('sites').upsert({
    id: site.id,
    user_id: userId,
    company_name: site.data.shopName,
    industry: 'barbershop',
    service_area: site.data.area,
    phone: site.data.phone,
    brand_colour: '#f4a100',
    site_data: site.data,
    deployed_url: site.deployedUrl,
    deployment_status: site.deploymentStatus,
    custom_domain: site.customDomain,
    domain_order_id: site.domainOrderId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) {
    console.error('[Supabase] upsertSite error:', error);
    throw error;
  }
}

export async function fetchUserSites(userId: string): Promise<SiteInstance[]> {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data || []).map(row => ({
    id: row.id,
    data: row.site_data as any,
    lastSaved: new Date(row.updated_at).getTime(),
    formInputs: {
      shopName: row.company_name,
      area: row.service_area || '',
      phone: row.phone || '',
    },
    deployedUrl: row.deployed_url,
    deploymentStatus: row.deployment_status || 'draft',
    customDomain: row.custom_domain,
    domainOrderId: row.domain_order_id,
  }));
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users_profile')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data as UserProfile;
}
