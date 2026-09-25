export {
  GitHubRepositoryRefError,
  formatRepositoryRef,
  parseRepositoryRef,
} from './github-repository-ref.js';
export type { GitHubRepositoryRef } from './github-repository-ref.js';

export {
  GITHUB_APP_ENV_VARS,
  GITHUB_PERSONAL_TOKEN_ENV_VARS,
  GitHubAuthConfigError,
  isGitHubAppEnvComplete,
  loadGitHubAppCredentialsFromEnv,
} from './github-app-credentials.js';
export type {
  GitHubAppCredentials,
  LoadGitHubAppCredentialsDeps,
} from './github-app-credentials.js';

export { createGitHubAppJwt } from './create-github-app-jwt.js';

export { GitHubAuthError, authenticateGitHubApp } from './authenticate-github-app.js';
export type {
  AuthenticateGitHubAppDeps,
  GitHubInstallationToken,
} from './authenticate-github-app.js';

export {
  GitHubApiError,
  GitHubRateLimitError,
  createGitHubHttp,
} from './github-http.js';
export type { GitHubFetch, GitHubHttp, GitHubHttpRequest, GitHubHttpResponse } from './github-http.js';

export { createGitHubRestCommitSource } from './create-github-rest-commit-source.js';
export type { CreateGitHubRestCommitSourceOptions } from './create-github-rest-commit-source.js';

export type {
  GitHubCommitSource,
  ListCommitsRequest,
  RawCommit,
  RawPullRequest,
} from './github-commit-source.js';

export { FindCandidateCommitsError, findCandidateCommits } from './find-candidate-commits.js';
export type { FindCandidateCommitsRequest } from './find-candidate-commits.js';

export { classifyTemporalRelation } from './classify-temporal-relation.js';
export { matchPatternHints } from './match-pattern-hints.js';
