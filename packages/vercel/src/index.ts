/**
 * Preview deployment resolution. Implemented in M3.
 *
 * The default path uses no Vercel credentials at all: the customer already has
 * the Vercel GitHub integration, so preview URLs arrive on the GitHub
 * deployment_status webhook. A Vercel token is optional and only buys build
 * logs on failure and the ability to trigger deploys ourselves.
 *
 * Correlation is by repository plus head SHA, because that is all the webhook
 * gives us that we control. A monorepo can produce several previews for one
 * SHA, so resolution must cope with more than one match rather than assuming
 * exactly one.
 */

export interface PreviewDeployment {
  url: string;
  environment: string;
  state: "pending" | "success" | "failure" | "error";
  repoFullName: string;
  headSha: string;
  projectName?: string;
}

export interface PreviewResolver {
  onDeploymentStatus(deployment: PreviewDeployment): Promise<void>;
}
