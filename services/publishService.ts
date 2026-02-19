import { SiteInstance, WebsiteData } from '../types';
import { generateHTMLWithPlaceholders } from '../components/GeneratedWebsite';
import { dualWriteSave } from './saveService';

export async function publishSite(site: SiteInstance, userId: string | null): Promise<{ url: string }> {
  // Step 1: Force save before publish
  await dualWriteSave(site, userId);

  const siteSlug = site.data.shopName
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Step 2: Upload any base64 images to GCS (sequential to avoid overload)
  const imageUrlMap: Record<string, string> = {};
  const imagesToUpload: Array<{ key: string; filename: string; base64: string }> = [];

  // Collect base64 images
  if (site.data.hero.imageUrl?.startsWith('data:')) {
    imagesToUpload.push({ key: 'hero', filename: 'hero.jpg', base64: site.data.hero.imageUrl });
  } else if (site.data.hero.imageUrl?.startsWith('http')) {
    imageUrlMap['hero'] = site.data.hero.imageUrl;
  }

  if (site.data.about.imageUrl?.startsWith('data:')) {
    imagesToUpload.push({ key: 'about', filename: 'about.jpg', base64: site.data.about.imageUrl });
  } else if (site.data.about.imageUrl?.startsWith('http')) {
    imageUrlMap['about'] = site.data.about.imageUrl;
  }

  site.data.gallery.forEach((url, i) => {
    if (url?.startsWith('data:')) {
      imagesToUpload.push({ key: `gallery${i}`, filename: `gallery-${i}.jpg`, base64: url });
    } else if (url?.startsWith('http')) {
      imageUrlMap[`gallery${i}`] = url;
    }
  });

  // Sequential uploads (one at a time)
  for (const image of imagesToUpload) {
    const response = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: siteSlug, filename: image.filename, base64: image.base64 }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Image upload failed for ${image.key}: ${errText}`);
    }
    const { publicUrl } = await response.json();
    imageUrlMap[image.key] = publicUrl;
  }

  // Step 3: Generate HTML with placeholder markers
  const restoredSiteData: WebsiteData = {
    ...site.data,
    hero: { ...site.data.hero, imageUrl: imageUrlMap['hero'] ? 'has-image' : '' },
    about: { ...site.data.about, imageUrl: imageUrlMap['about'] ? 'has-image' : '' },
    gallery: site.data.gallery.map((_: string, i: number) =>
      imageUrlMap[`gallery${i}`] ? 'has-image' : ''
    ),
  };

  const html = generateHTMLWithPlaceholders(restoredSiteData);

  // Step 4: Deploy to Vercel
  const deployResponse = await fetch('/api/deploy-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: siteSlug, html, imageUrls: imageUrlMap }),
  });

  const contentType = deployResponse.headers.get('content-type');
  let deployData;
  if (contentType?.includes('application/json')) {
    deployData = await deployResponse.json();
  } else {
    const text = await deployResponse.text();
    throw new Error(`Deployment failed: ${text || `HTTP ${deployResponse.status}`}`);
  }

  if (!deployResponse.ok) {
    throw new Error(`Deployment failed: ${deployData.error || deployData.details || 'Unknown error'}`);
  }

  return { url: deployData.deploymentUrl };
}
