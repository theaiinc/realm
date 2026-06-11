/** Options for creating an Ubuntu Desktop realm */
export interface UbuntuOptions {
  /** Display resolution (default: 1920x1080) */
  resolution?: string;
  /** Color depth (default: 24) */
  depth?: number;
  /** VNC port on host (default: 5901) */
  vncPort?: number;
  /** Container memory limit in MB (default: 2048) */
  memoryMb?: number;
  /** CPU count (default: 2) */
  cpus?: number;
  /** Disk size in GB (default: 20) */
  diskGb?: number;
  /** Timezone (default: UTC) */
  timezone?: string;
  /** Locale (default: en_US.UTF-8) */
  locale?: string;
  /** Capability presets to register with Yggdrasil (default: agent,code) */
  capabilities?: string[];
}

/**
 * Yggdrasil configuration for Ratatoskr daemon embedded in the realm.
 * Passed to the container as environment variables.
 */
export interface YggdrasilConfig {
  /** Yggdrasil server URL (required) */
  url: string;
  /** API key for Yggdrasil auth */
  apiKey?: string;
  /** Runner name reported to Yggdrasil (default: realm-<realmId>) */
  runnerName?: string;
  /** Capability presets (default: ['agent', 'code']) */
  capabilities?: string[];
  /** Heartbeat interval in seconds (default: 30) */
  heartbeatInterval?: number;
  /** Lease TTL in seconds (default: 60) */
  leaseTtl?: number;
  /** Task poll interval in seconds (default: 10, 0 = disable) */
  taskPollInterval?: number;
  /** LLM model for agent capability (default: google/gemma-4-26b-a4b-qat) */
  llmModel?: string;
  /** LLM base URL for agent capability (default: http://host.docker.internal:1234/v1) */
  llmBaseUrl?: string;
  /** LLM API key */
  llmApiKey?: string;
  /** Max tool iterations per agent task (default: 25) */
  agentMaxToolIterations?: number;
}
