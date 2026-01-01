import axios from 'axios';

interface VercelFile {
  file: string;
  data: string;
  encoding?: 'base64' | 'utf-8';
}

interface DeploymentResult {
  deploymentUrl: string;
  inspectorUrl?: string;
  deploymentId?: string;
}

/**
 * Deploys a static site to Vercel using the Deployments API
 *
 * @param projectName - The name of the Vercel project (will be sanitized)
 * @param files - Array of files to deploy (with base64 encoded data)
 * @returns Promise with the deployment URL
 * @throws Error if deployment fails or credentials are missing
 */
export async function deployToVercel(
  projectName: string,
  files: VercelFile[]
): Promise<DeploymentResult> {
  try {
    // Validate inputs
    if (!projectName) {
      throw new Error('Missing required parameter: projectName');
    }

    if (!files || files.length === 0) {
      throw new Error('Missing required parameter: files array cannot be empty');
    }

    // Get environment variables
    const vercelToken = process.env.VERCEL_TOKEN;
    const vercelProjectName = process.env.VERCEL_PROJECT_NAME;

    if (!vercelToken) {
      throw new Error('VERCEL_TOKEN environment variable is not set');
    }

    // Use env var project name if set, otherwise use provided projectName
    const finalProjectName = vercelProjectName || projectName;

    // Sanitize project name (Vercel requirements: lowercase, alphanumeric, hyphens)
    const sanitizedProjectName = finalProjectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    console.log(`[Vercel Deploy] Starting deployment for project: ${sanitizedProjectName}`);
    console.log(`[Vercel Deploy] Total files: ${files.length}`);

    // Log file names (but not data)
    const fileNames = files.map(f => f.file).join(', ');
    console.log(`[Vercel Deploy] Files: ${fileNames}`);

    // Prepare deployment payload
    const deploymentPayload = {
      name: sanitizedProjectName,
      files: files,
      target: 'production',
      projectSettings: {
        framework: null, // Static site, no framework
      },
    };

    // Call Vercel Deployments API
    console.log('[Vercel Deploy] Calling Vercel API...');

    const response = await axios.post(
      'https://api.vercel.com/v13/deployments',
      deploymentPayload,
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000, // 2 minute timeout
      }
    );

    const responseData = response.data;

    // Extract deployment URL
    let deploymentUrl: string;

    if (responseData.url) {
      deploymentUrl = `https://${responseData.url}`;
    } else if (responseData.alias && responseData.alias.length > 0) {
      deploymentUrl = `https://${responseData.alias[0]}`;
    } else {
      // Fallback to inspector URL
      deploymentUrl = responseData.inspectorUrl || 'Unknown';
    }

    console.log(`[Vercel Deploy] Deployment successful!`);
    console.log(`[Vercel Deploy] URL: ${deploymentUrl}`);

    return {
      deploymentUrl,
      inspectorUrl: responseData.inspectorUrl,
      deploymentId: responseData.id,
    };

  } catch (error: any) {
    // Log error details without exposing secrets
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const errorMessage = error.response?.data?.error?.message || error.message;

      console.error('[Vercel Deploy] Deployment failed');
      console.error(`[Vercel Deploy] HTTP Status: ${status} ${statusText}`);
      console.error(`[Vercel Deploy] Error message: ${errorMessage}`);

      // Provide helpful error messages based on status code
      if (status === 401 || status === 403) {
        throw new Error('Vercel authentication failed. Please check your VERCEL_TOKEN.');
      } else if (status === 413) {
        throw new Error('Deployment payload too large. Total size exceeds Vercel limits (4.5MB for body).');
      } else if (status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (status === 400) {
        // Try to provide more specific error info
        const detailMessage = error.response?.data?.error?.message || 'Bad request';
        throw new Error(`Vercel API error: ${detailMessage}`);
      } else {
        throw new Error(`Vercel deployment failed: ${errorMessage}`);
      }
    }

    // Handle non-axios errors
    console.error('[Vercel Deploy] Unexpected error:', error.message);

    if (error.message.includes('environment variable')) {
      throw error; // Safe error message about env vars
    }

    throw new Error(`Failed to deploy to Vercel: ${error.message}`);
  }
}

/**
 * Helper function to validate file data before deployment
 *
 * @param files - Array of files to validate
 * @returns True if valid, throws error otherwise
 */
export function validateDeploymentFiles(files: VercelFile[]): boolean {
  if (!Array.isArray(files)) {
    throw new Error('Files must be an array');
  }

  if (files.length === 0) {
    throw new Error('Files array cannot be empty');
  }

  // Check for index.html
  const hasIndexHtml = files.some(f => f.file === 'index.html');
  if (!hasIndexHtml) {
    console.warn('[Vercel Deploy] Warning: No index.html found in files');
  }

  // Validate each file
  files.forEach((file, index) => {
    if (!file.file) {
      throw new Error(`File at index ${index} is missing 'file' property`);
    }

    if (!file.data) {
      throw new Error(`File '${file.file}' is missing 'data' property`);
    }

    // Check if encoding is specified
    if (!file.encoding) {
      console.warn(`[Vercel Deploy] File '${file.file}' has no encoding specified, defaulting to utf-8`);
    }
  });

  console.log('[Vercel Deploy] File validation passed');
  return true;
}

/**
 * Calculate approximate payload size in MB
 *
 * @param files - Array of files
 * @returns Size in megabytes
 */
export function calculatePayloadSize(files: VercelFile[]): number {
  const totalBytes = files.reduce((sum, file) => {
    // Approximate JSON size
    const fileSize = JSON.stringify(file).length;
    return sum + fileSize;
  }, 0);

  const sizeInMB = totalBytes / (1024 * 1024);

  console.log(`[Vercel Deploy] Estimated payload size: ${sizeInMB.toFixed(2)} MB`);

  if (sizeInMB > 4.5) {
    console.warn('[Vercel Deploy] Warning: Payload size exceeds 4.5MB, deployment may fail');
  }

  return sizeInMB;
}
