# DOEM Platform Discovery

## Summary

The DOEM website lists **1000+ cities** across multiple states, but the original `querido-diario` repository only implements **56 cities**.

## Cities Available on DOEM Website

| State | Cities on Website | Cities in Repo | Missing |
|-------|-------------------|----------------|---------|
| Bahia (BA) | 417 | 52 | 365 |
| Pernambuco (PE) | 185 | 1 | 184 |
| Paraná (PR) | 400 | 2 | 398 |
| Sergipe (SE) | ? | 1 | ? |
| **TOTAL** | **1000+** | **56** | **950+** |

## Testing Results

We tested 5 new cities from Bahia that are NOT in the original repository:

| City | Status | Gazettes Found | Notes |
|------|--------|----------------|-------|
| Juazeiro | ✅ Working | 70 | Fully functional |
| Salvador | ⚠️ Unavailable | 0 | Shows "Indisponível" on website |
| Feira de Santana | ⚠️ Unknown | 0 | Need to verify URL slug |
| Vitória da Conquista | ⚠️ Unknown | 0 | Need to verify URL slug |
| Camaçari | ⚠️ Unknown | 0 | Need to verify URL slug |

## Key Findings

1. **Not all cities listed on DOEM website are active**
   - Some show "Indisponível" (Unavailable)
   - Some may not have published recently

2. **URL slugs may vary**
   - Example: `feiraDeSantana` vs `feira-de-santana` vs `feiradesantana`
   - Need to verify correct slug for each city

3. **The DOEM spider works correctly**
   - Successfully extracted 70 gazettes from Juazeiro
   - Same structure as existing cities

## Recommendations

### Phase 1: Validate Existing Cities (DONE ✅)
- [x] Test 56 cities from original repo
- [x] Confirm DOEM spider works correctly

### Phase 2: Expand Bahia Coverage
- [ ] Extract all 417 Bahia cities from DOEM website
- [ ] Test a sample of 10-20 cities to verify they work
- [ ] Filter out "Indisponível" cities
- [ ] Add working cities to config

### Phase 3: Add Other States
- [ ] Pernambuco (185 cities)
- [ ] Paraná (400 cities)
- [ ] Sergipe (? cities)
- [ ] Other states

### Phase 4: Handle Edge Cases
- [ ] Detect "Indisponível" pages automatically
- [ ] Try multiple URL slug variations
- [ ] Add retry logic for failed cities

## Next Steps

1. Focus on Bahia first (417 potential cities)
2. Create script to extract all city slugs from DOEM website
3. Test sample of 20 cities to estimate success rate
4. Add working cities incrementally with commits
5. Document which cities are unavailable

## Impact

If we successfully add all working DOEM cities:
- Current: **56 cities**
- Potential: **1000+ cities**
- **17x increase** in coverage! 🚀
