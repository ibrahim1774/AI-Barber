import { WebsiteData } from '../types';

export interface DeploymentResult {
  success: boolean;
  githubUrl?: string;
  deploymentUrl?: string;
  message?: string;
  error?: string;
  details?: string;
}

export const deployWebsite = async (websiteData: WebsiteData): Promise<DeploymentResult> => {
  try {
    const response = await fetch('/api/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(websiteData),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.details || 'Deployment failed');
    }

    return data;
  } catch (error: any) {
    return {
      success: false,
      error: 'Deployment failed',
      details: error.message || 'Unknown error occurred',
    };
  }
};
