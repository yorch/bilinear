import { describe, expect, it } from 'vitest';
import { getIntegrationAvailability } from './integration-availability';

describe('getIntegrationAvailability', () => {
  it('is false for both when nothing is set', () => {
    expect(getIntegrationAvailability({})).toEqual({
      githubConfigured: false,
      slackConfigured: false,
    });
  });

  it('requires both the client id and the secret', () => {
    expect(getIntegrationAvailability({ GITHUB_CLIENT_ID: 'id' }).githubConfigured).toBe(false);
    expect(getIntegrationAvailability({ SLACK_CLIENT_SECRET: 's' }).slackConfigured).toBe(false);
    expect(
      getIntegrationAvailability({
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 's',
        SLACK_CLIENT_ID: 'id',
        SLACK_CLIENT_SECRET: 's',
      }),
    ).toEqual({ githubConfigured: true, slackConfigured: true });
  });

  it('treats whitespace-only values as unset', () => {
    expect(
      getIntegrationAvailability({ GITHUB_CLIENT_ID: '  ', GITHUB_CLIENT_SECRET: 's' })
        .githubConfigured,
    ).toBe(false);
  });
});
