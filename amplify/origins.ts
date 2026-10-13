export const PRODUCTION_ORIGIN = "https://round-about.chreisel.net";

/**
 * Browser origins the game API accepts. Amplify Hosting builds set
 * AWS_BRANCH and AWS_APP_ID; a local sandbox sets neither.
 */
export function allowedOrigins(env: {
  AWS_BRANCH?: string;
  AWS_APP_ID?: string;
}): string[] {
  if (!env.AWS_BRANCH)
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  return [
    PRODUCTION_ORIGIN,
    ...(env.AWS_APP_ID
      ? [`https://${env.AWS_BRANCH}.${env.AWS_APP_ID}.amplifyapp.com`]
      : []),
  ];
}
