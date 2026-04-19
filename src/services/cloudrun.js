import { google } from 'googleapis';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CloudRunService');

/**
 * Get an authenticated Google API client.
 * Uses Application Default Credentials (ADC) or GOOGLE_APPLICATION_CREDENTIALS.
 */
async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
    ],
  });
  return auth.getClient();
}

/**
 * Trigger a Cloud Build to build and deploy a preview of the Next.js app.
 *
 * @param {Object} params
 * @param {string} params.branchName - The Git branch to build from
 * @param {number} params.prNumber - The PR number (used for naming the preview service)
 * @returns {string} The preview URL
 */
export async function deployPreview({ branchName, prNumber }) {
  log.info(`Deploying preview for PR #${prNumber} (branch: ${branchName})`);

  const authClient = await getAuthClient();
  const cloudbuild = google.cloudbuild({ version: 'v1', auth: authClient });

  const projectId = config.gcp.projectId;
  const region = config.gcp.region;
  const serviceName = `preview-pr-${prNumber}`;
  const imageTag = `${region}-docker.pkg.dev/${projectId}/previews/${config.github.repo}:pr-${prNumber}`;

  // Submit a Cloud Build that:
  // 1. Clones the repo at the PR branch
  // 2. Builds a Docker image
  // 3. Pushes to Artifact Registry
  // 4. Deploys to Cloud Run
  const buildConfig = {
    projectId,
    requestBody: {
      steps: [
        // Step 1: Clone the repository at the specific branch
        {
          name: 'gcr.io/cloud-builders/git',
          args: [
            'clone',
            '--branch', branchName,
            '--depth', '1',
            `https://x-access-token:${config.github.token}@github.com/${config.github.owner}/${config.github.repo}.git`,
            '/workspace/app',
          ],
        },
        // Step 2: Build the Docker image
        {
          name: 'gcr.io/cloud-builders/docker',
          args: ['build', '-t', imageTag, '.'],
          dir: '/workspace/app',
        },
        // Step 3: Push the Docker image to Artifact Registry
        {
          name: 'gcr.io/cloud-builders/docker',
          args: ['push', imageTag],
        },
        // Step 4: Deploy to Cloud Run
        {
          name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
          entrypoint: 'gcloud',
          args: [
            'run', 'deploy', serviceName,
            '--image', imageTag,
            '--region', region,
            '--platform', 'managed',
            '--allow-unauthenticated',
            '--port', '3000',
            '--memory', '512Mi',
            '--max-instances', '1',
            '--set-env-vars', `NODE_ENV=preview,PR_NUMBER=${prNumber}`,
            '--quiet',
          ],
        },
      ],
      timeout: '1200s', // 20 minutes max
      options: {
        logging: 'CLOUD_LOGGING_ONLY',
      },
    },
  };

  try {
    const [operation] = await cloudbuild.projects.builds.create(buildConfig);
    const buildId = operation.metadata?.build?.id;

    log.info(`Cloud Build triggered: ${buildId}`);

    // Poll for build completion
    const previewUrl = await waitForBuildAndGetUrl({
      cloudbuild,
      projectId,
      buildId,
      region,
      serviceName,
    });

    return previewUrl;
  } catch (err) {
    log.error('Failed to deploy preview', { error: err.message });
    throw err;
  }
}

/**
 * Poll Cloud Build until completion, then fetch the Cloud Run service URL.
 */
async function waitForBuildAndGetUrl({ cloudbuild, projectId, buildId, region, serviceName }) {
  log.info(`Waiting for build ${buildId} to complete...`);

  const maxWait = 20 * 60 * 1000; // 20 minutes
  const pollInterval = 15 * 1000; // 15 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const { data: build } = await cloudbuild.projects.builds.get({
      projectId,
      id: buildId,
    });

    const status = build.status;
    log.debug(`Build ${buildId} status: ${status}`);

    if (status === 'SUCCESS') {
      log.info('Build completed successfully!');

      // Get the Cloud Run service URL
      const previewUrl = await getCloudRunServiceUrl(region, serviceName);
      return previewUrl;
    }

    if (['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'].includes(status)) {
      const logUrl = build.logUrl;
      throw new Error(`Build failed with status: ${status}. Logs: ${logUrl}`);
    }

    await sleep(pollInterval);
  }

  throw new Error('Build timed out after 20 minutes');
}

/**
 * Get the URL of a Cloud Run service.
 */
async function getCloudRunServiceUrl(region, serviceName) {
  const authClient = await getAuthClient();
  const run = google.run({ version: 'v2', auth: authClient });

  const projectId = config.gcp.projectId;
  const name = `projects/${projectId}/locations/${region}/services/${serviceName}`;

  try {
    const { data: service } = await run.projects.locations.services.get({ name });
    const url = service.uri;
    log.info(`Preview URL: ${url}`);
    return url;
  } catch (err) {
    log.warn(`Could not fetch Cloud Run service URL: ${err.message}`);
    return `https://${serviceName}-${projectId}.${region}.run.app`;
  }
}

/**
 * Delete a preview Cloud Run service (cleanup when PR is closed/merged).
 */
export async function deletePreview(prNumber) {
  const serviceName = `preview-pr-${prNumber}`;
  log.info(`Deleting preview service: ${serviceName}`);

  try {
    const authClient = await getAuthClient();
    const run = google.run({ version: 'v2', auth: authClient });

    const projectId = config.gcp.projectId;
    const region = config.gcp.region;
    const name = `projects/${projectId}/locations/${region}/services/${serviceName}`;

    await run.projects.locations.services.delete({ name });
    log.info(`Preview service ${serviceName} deleted`);
  } catch (err) {
    log.warn(`Failed to delete preview service: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
