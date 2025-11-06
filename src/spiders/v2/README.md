# V2 Spider Registry - Cloudflare Workers Compatible

This directory contains the V2 spider registry system that works with Cloudflare Workers infrastructure.

## Adding New States

To add a new state configuration:

1. **Create the JSON config file**: Add a new JSON file in `configs/` directory with the state code as filename (e.g., `rj.json`, `mg.json`)

2. **Update the registry imports**: In `registry.ts`, add the import for your new state:
   ```typescript
   import rjConfigs from './configs/rj.json';
   ```

3. **Add to STATE_CONFIGS**: Include the new state in the `STATE_CONFIGS` object:
   ```typescript
   const STATE_CONFIGS = {
     'SP': spConfigs,
     'RJ': rjConfigs,  // Add your new state here
     // etc.
   } as const;
   ```

## File Structure

```
v2/
├── configs/
│   ├── sp.json          # São Paulo state territories
│   ├── rj.json          # Rio de Janeiro state territories (example)
│   └── ...              # Other state files
├── registry.ts          # Main registry with static imports
├── types.ts            # Type definitions
├── executor.ts         # Territory execution logic
└── README.md           # This file
```

## Config File Format

Each state JSON file should contain an array of territory configurations:

```json
[
  {
    "id": "sp_cristais_paulista",
    "name": "Cristais Paulista - SP", 
    "territoryId": "3513207",
    "stateCode": "SP",
    "active": true,
    "spiders": [
      {
        "spiderType": "dosp",
        "priority": 1,
        "active": true,
        "gazetteScope": "state",
        "config": {
          // Spider-specific configuration
        }
      }
    ]
  }
]
```

## Key Features

- **Cloudflare Workers Compatible**: Uses static imports instead of filesystem operations
- **State-based Organization**: Each state has its own JSON file
- **Automatic State Detection**: State code is derived from filename
- **Backward Compatibility**: Maintains compatibility with existing spider interfaces
- **Priority-based Execution**: Supports priority fallback and parallel execution strategies

## Usage

```typescript
import { SpiderRegistryV2 } from './registry';

const registry = new SpiderRegistryV2();

// Get all territories for a state
const spTerritories = registry.getTerritoriesByState('SP');

// Get configured states
const states = registry.getConfiguredStates(); // ['SP', 'RJ', ...]

// Get active spiders for a territory
const spiders = registry.getActiveSpidersForTerritory('3513207');
```
