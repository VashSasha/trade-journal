# Tradovate Report API Testing

## Problem
Getting `Invalid JSON: illegal number, offset: 0x00000036` error when requesting fills report

## Test Scenarios

### Test 1: MM/DD/YYYY format (original)
```json
{
    "name": "Fills",
    "representationType": "csv",
    "timezone": "UTC",
    "params": [
        {
            "name": "startDate",
            "value": "01/01/2020"
        },
        {
            "name": "endDate",
            "value": "02/16/2026"
        }
    ]
}
```
Result: `Invalid JSON: illegal number, offset: 0x00000036`

### Test 2: YYYYMMDD format
```json
{
    "name": "Fills",
    "representationType": "csv",
    "timezone": "UTC",
    "params": [
        {
            "name": "startDate",
            "value": "20200101"
        },
        {
            "name": "endDate",
            "value": "20260216"
        }
    ]
}
```
Result: `Invalid JSON: illegal number, offset: 0x00000036`

### Test 3: Try with accountId parameter
Maybe the Fills report requires an accountId parameter?

### Test 4: Try ISO date format
```json
{
    "name": "Fills",
    "representationType": "csv",
    "timezone": "UTC",
    "params": [
        {
            "name": "startDate",
            "value": "2020-01-01"
        },
        {
            "name": "endDate",
            "value": "2026-02-16"
        }
    ]
}
```

### Test 5: Call requestreportdefinitions first
Get the exact spec for the Fills report to understand required parameters

## Debugging Steps
1. Call `/reports/request reportdefinitions` to see the exact format
2. Look at the network tab when generating a report in Tradovate Trader
3. Check if an accountId is required
4. Verify the Authorization header is correctly formatted
