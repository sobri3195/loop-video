# MCP Debugging Guide - Video Auto Clipper

This document provides a comprehensive debugging framework for the Video Auto Clipper application, focusing on Model Context Protocol (MCP) errors and common issues.

## MCP Architecture Overview

The Video Auto Clipper uses several critical components that interact with Model Context Protocol:

### 1. FFmpeg.wasm Integration
- **Core**: `@ffmpeg/ffmpeg` library
- **Loading**: Dynamic loading from unpkg CDN
- **Isolation**: Requires SharedArrayBuffer support
- **Error Points**: Loading failures, memory issues, processing errors

### 2. React State Management
- Multiple state updates in async operations
- Object URL lifecycle management
- Progress tracking and cancellation

### 3. Browser APIs
- File System Access API (Blob URLs)
- Web Workers (FFmpeg runs in worker)
- Media APIs (video element)

## Common MCP Error Categories

## Category 1: Memory Management Errors 🔴 CRITICAL

### 1.1 Object URL Memory Leaks

**Symptoms:**
- Browser memory consumption increases continuously
- Application slows down after multiple video uploads
- "Out of memory" errors in console
- Blob URLs not released

**Root Cause:**
- Video file URLs created but not properly revoked
- Thumbnail URLs accumulate without cleanup
- No cleanup in unmount scenarios

**Detection:**
```javascript
// Check in browser devtools console:
chrome://blob-internals/  // Shows active blob URLs
chrome://memory-internals/ // Memory usage analysis
```

**MCP Error Codes:**
- `MCP-001`: Blob URL leak detected
- `MCP-002`: Memory threshold exceeded

**Critical Fix Locations:**
- Line 124: `URL.createObjectURL(file)` - no cleanup on component unmount
- Line 330: Clip URLs created, never revoked
- Line 344: Thumbnail URLs created, never revoked
- Line 512: Video removal doesn't clean up all URLs

---

## Category 2: Processing Pipeline Errors 🔴 CRITICAL

### 2.1 FFmpeg Command Construction Errors

**Symptoms:**
- Clips stuck at 0% progress
- FFmpeg execution hangs indefinitely
- "Invalid argument" errors in FFmepg logs
- Zero-byte output files

**Root Cause:**
- Incorrect argument ordering in FFmpeg commands
- Missing parameters for accurate seeking
- Timestamp handling issues

**Detection:**
```javascript
// FFmpeg logs show:
// "Non-monotonous DTS in output stream" warnings
// "Invalid argument" errors
// Process stalls with no progress
```

**MCP Error Codes:**
- `MCP-101`: FFmpeg command construction failed
- `MCP-102`: Seeking parameter missing
- `MCP-103`: Timeline discontinuity detected

**Critical Fix Locations:**
- Line 273-283: Copy mode command construction
- Line 286-321: Encode mode command construction
- Missing `-accurate_seek` and `-avoid_negative_ts` in some modes

### 2.2 Input/Output File Handling

**Symptoms:**
- "File not found" errors in FFmpeg logs
- Special characters in filenames cause failures
- Files not written to virtual FS

**MCP Error Codes:**
- `MCP-201`: File write operation failed
- `MCP-202`: Invalid filename format
- `MCP-203`: Virtual FS access denied

**Detection:**
```javascript
// Check FFmpeg logs for:
// "No such file or directory"
// "Invalid argument" on filename
```

---

## Category 3: React State & Lifecycle Errors 🟡 MODERATE

### 3.1 Deprecation Warnings

**Symptoms:**
- Console warnings about deprecated methods
- Future compatibility issues
- Potential breaking changes in React updates

**Detection:**
```
Warning: substr() is deprecated
Warning: componentWillReceiveProps is deprecated
```

**MCP Error Codes:**
- `MCP-301`: Deprecated method usage
- `MCP-302`: Future React incompatibility

**Critical Fix Locations:**
- Line 348: `Math.random().toString(36).substr(2, 9)` 
- Line 362: Same issue
- Should use `slice()` instead of `substr()`

### 3.2 Stale State in Async Loops

**Symptoms:**
- Clips not updating correctly during processing
- Missing clips in results
- Progress bar inconsistent

**Root Cause:**
- State updates inside async for-loops
- Closure capturing stale state values
- Multiple concurrent state updates

**MCP Error Codes:**
- `MCP-401`: Stale state detected in async operation
- `MCP-402`: State update race condition

**Critical Fix Locations:**
- Line 376: `setClips([...generatedClips])` in loop
- Line 377: Progress update
- Line 358: Clip generation with random ID

---

## Category 4: Cancellation & Control Flow Errors 🟡 MODERATE

### 4.1 Cancellation Logic Bugs

**Symptoms:**
- Cancel button doesn't work for first clip
- Processing continues after cancellation
- Partial clip generation

**Root Cause:**
- Bug in cancellation condition: `(!shouldProcessRef.current && i > 0)`
- Why `i > 0`? Skips cancellation for first iteration

**MCP Error Codes:**
- `MCP-501`: Cancellation failed
- `MCP-502`: Process termination incomplete

**Critical Fix Locations:**
- Line 259: Buggy cancellation condition

### 4.2 Process State Management

**Symptoms:**
- UI stuck in processing state
- Multiple concurrent processes
- Race conditions in start/stop

**MCP Error Codes:**
- `MCP-601`: Concurrent process conflict
- `MCP-602`: State transition invalid

---

## Category 5: User Experience Errors 🟢 MINOR

### 5.1 UI/UX Issues

**Symptoms:**
- No visual feedback during thumbnail generation
- Cancel button doesn't confirm before aborting
- Error messages not user-friendly

**MCP Error Codes:**
- `MCP-701`: UI feedback missing
- `MCP-702`: User confirmation required

---

## Debugging Workflow

### Step 1: Error Identification

1. **Open Browser DevTools**
   ```
   F12 or Ctrl+Shift+I (Windows/Linux)
   Cmd+Option+I (Mac)
   ```

2. **Check Console Tab**
   - Red errors (critical)
   - Yellow warnings (moderate)
   - Blue info logs

3. **Monitor Network Tab**
   - Check FFmpeg core loading
   - CDN connectivity issues

4. **Memory Profiling**
   - Performance tab → Memory
   - Record heap snapshots
   - Check for Blob URL accumulation

### Step 2: Error Classification

Use this decision tree:

```
Is the app completely unresponsive?
├── YES → Check MCP-1XX (FFmpeg failures)
└── NO
    └── Is memory increasing continuously?
        ├── YES → MCP-001/MCP-002 (Memory leak)
        └── NO
            └── Does cancel button not work?
                ├── YES → MCP-501 (Cancellation bug)
                └── NO
                    └── Do clips not appear after processing?
                        ├── YES → MCP-401 (State issues)
                        └── NO → UI/UX issues (MCP-701+)
```

### Step 3: Log Analysis

**Enable Debug Logging:**
```javascript
// Add to App.jsx
const DEBUG = true;

function debugLog(code, message, data = null) {
  if (DEBUG) {
    console.log(`[MCP-${code}] ${message}`, data || '');
  }
}
```

**View FFmpeg Logs:**
```javascript
// FFmpeg already has logging
ffmpeg.on('log', ({ message }) => {
  console.log('[FFmpeg]', message);
});
```

### Step 4: Fix Implementation

For each error category:

1. **Memory Leaks (MCP-001/002)**
   - Use `URL.revokeObjectURL()` in cleanup
   - Track all created URLs
   - Implement useEffect cleanup

2. **FFmpeg Pipeline (MCP-101/102)**
   - Verify command construction
   - Add missing parameters
   - Test with different video formats

3. **React Deprecations (MCP-301)**
   - Replace deprecated methods
   - Test with React StrictMode

4. **State Issues (MCP-401/402)**
   - Refactor state updates
   - Use functional updates
   - Avoid mutations

5. **Cancellation (MCP-501)**
   - Fix logic bugs
   - Test edge cases
   - Add cleanup logic

---

## Testing Checklist

Before deployment, verify:

- [ ] Multiple video uploads without memory increase
- [ ] All FFmpeg modes work (copy, encode, with effects)
- [ ] Cancellation works at any point
- [ ] No console warnings
- [ ] Progress bar accurate
- [ ] All clips generated correctly
- [ ] Thumbnails show for all clips
- [ ] ZIP download works
- [ ] No memory leaks after video removal
- [ ] Browser back button doesn't break state

---

## Emergency Recovery

If app breaks in production:

1. **Refresh page** (clears temporary state)
2. **Clear browser cache** (removes stale data)
3. **Check browser support** (SharedArrayBuffer required)
4. **Use another browser** (test cross-browser)
5. **Reduce video size** (memory constraints)

---

## MCP Error Reference Table

| Code | Severity | Component | Description |
|------|----------|-----------|-------------|
| MCP-001 | 🔴 | Memory | Blob URL leak |
| MCP-002 | 🔴 | Memory | Memory threshold exceeded |
| MCP-101 | 🔴 | FFmpeg | Command construction failed |
| MCP-102 | 🔴 | FFmpeg | Seeking parameter missing |
| MCP-201 | 🟡 | FFmpeg | File write operation failed |
| MCP-301 | 🟡 | React | Deprecated method usage |
| MCP-401 | 🟡 | React State | Stale state detected |
| MCP-501 | 🟡 | Control | Cancellation failed |
| MCP-701 | 🟢 | UI | Feedback missing |

---

## Resources

- [FFmpeg.wasm Documentation](https://ffmpegwasm.netlify.app/)
- [React Memory Leaks](https://react.dev/reference/react/useEffect#connecting-to-an-external-system)
- [Browser Memory Profiling](https://developer.chrome.com/docs/devtools/memory/)
- [SharedArrayBuffer Requirements](https://web.dev/cross-origin-isolation-guide/)

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Maintainer:** Development Team