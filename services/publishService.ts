import { SiteInstance, WebsiteData } from '../types';
import { generateHTMLForTemplate } from './templateRenderer';
import { dualWriteSave } from './saveService';

export async function publishSite(site: SiteInstance, userId: string | null): Promise<{ url: string; imageUrlMap: Record<string, string> }> {
  // Step 1: Save before publish — fire-and-forget so it doesn't gate the deploy.
  // Failures only mean the local snapshot lags; the post-publish save (with the
  // deployed URL stamped on) is the one that actually matters.
  dualWriteSave(site, userId).catch(err =>
    console.error('[publishSite] Pre-deploy save failed (non-blocking):', err)
  );

  const siteSlug = site.data.shopName
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Step 2: Collect base64 images, then upload in parallel
  const imageUrlMap: Record<string, string> = {};
  const imagesToUpload: Array<{ key: string; filename: string; base64: string }> = [];
  const timestamp = Date.now(); // Cache-busting: unique filename per publish

  if (site.data.hero.imageUrl?.startsWith('data:')) {
    imagesToUpload.push({ key: 'hero', filename: `hero-${timestamp}.jpg`, base64: site.data.hero.imageUrl });
  } else if (site.data.hero.imageUrl?.startsWith('http')) {
    imageUrlMap['hero'] = site.data.hero.imageUrl;
  }

  if (site.data.about.imageUrl?.startsWith('data:')) {
    imagesToUpload.push({ key: 'about', filename: `about-${timestamp}.jpg`, base64: site.data.about.imageUrl });
  } else if (site.data.about.imageUrl?.startsWith('http')) {
    imageUrlMap['about'] = site.data.about.imageUrl;
  }

  site.data.gallery.forEach((url, i) => {
    if (url?.startsWith('data:')) {
      imagesToUpload.push({ key: `gallery${i}`, filename: `gallery-${i}-${timestamp}.jpg`, base64: url });
    } else if (url?.startsWith('http')) {
      imageUrlMap[`gallery${i}`] = url;
    }
  });

  // Staff photos — mirror the gallery pattern. Each entry's photo
  // gets either uploaded (base64) or hotlinked (http) so the LUXE
  // template's `{{staff${i}}}` placeholder resolves either way.
  (site.data.staff || []).forEach((s, i) => {
    if (s?.photo?.startsWith('data:')) {
      imagesToUpload.push({ key: `staff${i}`, filename: `staff-${i}-${timestamp}.jpg`, base64: s.photo });
    } else if (s?.photo?.startsWith('http')) {
      imageUrlMap[`staff${i}`] = s.photo;
    }
  });

  // Parallel uploads — matches the pre-payment publish path. GCS handles
  // concurrent writes fine; sequential here was making re-publish take 6–12s.
  await Promise.all(
    imagesToUpload.map(async (image) => {
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
    })
  );

  // Step 3: Generate HTML with placeholder markers
  const restoredSiteData: WebsiteData = {
    ...site.data,
    hero: { ...site.data.hero, imageUrl: imageUrlMap['hero'] ? 'has-image' : '' },
    about: { ...site.data.about, imageUrl: imageUrlMap['about'] ? 'has-image' : '' },
    gallery: site.data.gallery.map((_: string, i: number) =>
      imageUrlMap[`gallery${i}`] ? 'has-image' : ''
    ),
    // Staff entries — keep the name + role, swap photo to a marker so
    // the LUXE template emits `{{staff${i}}}` placeholders that the
    // deploy endpoint string-substitutes with the GCS URLs.
    staff: (site.data.staff || []).map((s, i) => ({
      ...s,
      photo: imageUrlMap[`staff${i}`] ? 'has-image' : '',
    })),
  };

  const html = generateHTMLForTemplate(restoredSiteData);

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

  return { url: deployData.deploymentUrl, imageUrlMap };
}
