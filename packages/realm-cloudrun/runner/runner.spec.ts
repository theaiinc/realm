import { describe, expect, it } from 'vitest';

describe('runner child environment', () => {
  it('does not expose runner secrets while retaining the approved environment', async () => {
    const previous = {
      REALM_ID: process.env.REALM_ID,
      JOB_ID: process.env.JOB_ID,
      BUCKET: process.env.BUCKET,
      REALM_PREFIX: process.env.REALM_PREFIX,
      JOB_COMMAND_B64: process.env.JOB_COMMAND_B64,
      JOB_CWD: process.env.JOB_CWD,
      JOB_TIMEOUT_SECONDS: process.env.JOB_TIMEOUT_SECONDS,
      SECRET_RUNNER_TOKEN: process.env.SECRET_RUNNER_TOKEN,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      JOB_SPEC_ENV: process.env.JOB_SPEC_ENV,
      BUCKET_DIR: process.env.BUCKET_DIR,
    };

    process.env.REALM_ID = 'realm-test';
    process.env.JOB_ID = 'job-test';
    process.env.BUCKET = 'bucket-test';
    process.env.REALM_PREFIX = 'realms/realm-test';
    process.env.JOB_COMMAND_B64 = Buffer.from('true').toString('base64');
    process.env.JOB_CWD = '.';
    process.env.JOB_TIMEOUT_SECONDS = '60';
    process.env.SECRET_RUNNER_TOKEN = 'must-not-leak';
    process.env.PATH = '/safe/bin';
    process.env.HOME = '/safe/home';
    process.env.LANG = 'C.UTF-8';
    process.env.JOB_SPEC_ENV = JSON.stringify({ PUBLIC_FLAG: 'yes' });
    process.env.BUCKET_DIR = '/tmp/realm-runner-test-bucket';

    try {
      const { childEnvironment } = await import('./runner.js');
      const environment = childEnvironment();
      expect(environment.SECRET_RUNNER_TOKEN).toBeUndefined();
      expect(environment.PATH).toBe('/safe/bin');
      expect(environment.HOME).toBe('/safe/home');
      expect(environment.LANG).toBe('C.UTF-8');
      expect(environment.CI).toBe('1');
      expect(environment.PUBLIC_FLAG).toBe('yes');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});