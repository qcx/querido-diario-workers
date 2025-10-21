# City ID Standardization Plan

## Current Problem

The spider system has inconsistent naming conventions for city IDs, causing confusion and potential conflicts:

### Naming Patterns Found:
- **Name-based**: `{state}_{city_name}` (e.g., `ba_acajutiba`, `mg_betim`)
- **IBGE-based**: `{state}_{ibge_code}` (e.g., `am_1302603`, `ba_2900306`)

### Critical Issues:
1. **Same city, different IDs**: Acajutiba appears as both `ba_acajutiba` and `ba_2900306`
2. **Testing confusion**: Users don't know which format to use
3. **Maintenance overhead**: Multiple naming systems to maintain

## Proposed Solution

### **Standard Format: `{state_code_lowercase}_{ibge_code}`**

**Examples:**
- Manaus (AM): `am_1302603`
- Acajutiba (BA): `ba_2900306`
- São Paulo (SP): `sp_3550308`

### Why IBGE Codes?
1. **Unique**: One code per municipality
2. **Official**: Brazilian government standard
3. **Stable**: Don't change with city renames
4. **Unambiguous**: No special characters/accents

## Migration Strategy

### Phase 1: Create ID Mapping
```bash
# Generate mapping of current IDs to IBGE-based IDs
npm run generate-id-mapping
```

### Phase 2: Update Configurations
- Keep current IDs as aliases during transition
- Add new IBGE-based IDs as primary
- Update all config files gradually

### Phase 3: Update Testing Tools
```typescript
// Support both formats during transition
function resolveCity(input: string): string {
  // Try exact match first
  if (spiderRegistry.getConfig(input)) return input;
  
  // Try name-based lookup
  const cityName = input.replace(/^[a-z]{2}_/, '');
  const configs = spiderRegistry.getAllConfigs();
  const match = configs.find(c => 
    c.name.toLowerCase().includes(cityName.toLowerCase())
  );
  
  return match?.id || input;
}
```

### Phase 4: Documentation Update
- Update README with new standard
- Add migration guide for existing users
- Update testing examples

## Implementation Steps

1. ✅ **Document current state** (DONE)
2. 🔄 **Create ID mapping utility**
3. 📝 **Update test tooling to handle both formats**
4. 🔧 **Gradual config migration**
5. 📚 **Update documentation**
6. 🧹 **Remove legacy format (6 months later)**

## Benefits

- **Consistency**: One standard across all spiders
- **Reliability**: IBGE codes are stable and official
- **Discoverability**: Clear mapping to official municipality data
- **Maintainability**: Reduces complexity in testing and configuration

## Breaking Changes

- Legacy city name-based IDs will be deprecated
- Testing scripts will need format updates
- Configuration files will require migration

## Timeline

- **Week 1**: Create mapping utilities
- **Week 2**: Update testing tools with backward compatibility
- **Month 1**: Begin configuration migrations
- **Month 3**: Complete primary migrations
- **Month 6**: Remove legacy format support
