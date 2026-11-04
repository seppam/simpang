import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Channels, DriverDefinition } from './types.ts';

const DEFAULT_DIR = join(import.meta.dirname, '../../drivers');

// Loads every drivers/<name>/<version>.json plus drivers/<name>/channels.json
// ({ "stable": "v1", "canary": "v2" }). "stable" is what callers get by default;
// "canary" is the candidate that shadow traffic and evaluation compare against it.
export class DriverRegistry {
  private drivers = new Map<string, Map<string, DriverDefinition>>();
  private channels = new Map<string, Channels>();

  constructor(dir = DEFAULT_DIR) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const versions = new Map<string, DriverDefinition>();
      for (const file of readdirSync(join(dir, name)).filter((f) => /^v\d+\.json$/.test(f))) {
        const def = JSON.parse(readFileSync(join(dir, name, file), 'utf8')) as DriverDefinition;
        if (def.name !== name || `${def.version}.json` !== file) {
          throw new Error(`driver file ${name}/${file} declares ${def.name}@${def.version}`);
        }
        versions.set(def.version, def);
      }
      this.drivers.set(name, versions);
      const channelsFile = join(dir, name, 'channels.json');
      const channels: Channels = existsSync(channelsFile)
        ? JSON.parse(readFileSync(channelsFile, 'utf8'))
        : { stable: [...versions.keys()].sort().at(-1)! };
      if (!versions.has(channels.stable)) throw new Error(`driver ${name}: stable version ${channels.stable} not found`);
      this.channels.set(name, channels);
    }
  }

  // version: an explicit "v2", a channel name ("stable"/"canary"), or undefined (= stable).
  get(name: string, version?: string): DriverDefinition | undefined {
    const versions = this.drivers.get(name);
    if (!versions) return undefined;
    const channels = this.channels.get(name)!;
    const resolved = !version || version === 'stable' ? channels.stable : version === 'canary' ? channels.canary : version;
    return resolved ? versions.get(resolved) : undefined;
  }

  channelsOf(name: string): Channels | undefined {
    return this.channels.get(name);
  }

  list() {
    return [...this.drivers.entries()].map(([name, versions]) => ({
      name,
      versions: [...versions.keys()].sort(),
      channels: this.channels.get(name),
      description: this.get(name)?.description,
    }));
  }
}
