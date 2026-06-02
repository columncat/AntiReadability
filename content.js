(function() {
  // Prevent duplicate execution
  if (window.__antiReadabilityLoaded) {
    return;
  }
  window.__antiReadabilityLoaded = true;

  // Extension State variables
  let isActive = false;
  let currentMode = 'scramble'; // 'scramble', 'geometric', 'block', 'blur', 'image', 'restore'
  let undoHistory = []; // Stack of transactions. Transaction = array of changes
  let redoHistory = [];

  // Track original content for restoration
  const originalTextNodesMap = new Map();
  const originalImagesMap = new Map();
  
  // DOM references inside Shadow DOM
  let hostElement = null;
  let shadowRoot = null;
  let toolbarElement = null;
  let toastElement = null;
  let toastTimeout = null;

  // Geometrical Shapes list (curated for readability and font support on Windows/macOS)
  const GEOMETRIC_SHAPES = [
    '■', '▲', '▼', '◆', '●', '★', '♥', '♦', '♣', '♠', 
    '⚙', '✦', '✧', '◈', '▩', '▨', '▧', '▤', '▥', '▦', 
    '◎', '◐', '◑', '◒', '◓', '◔', '◕', '◖', '◗', '✿', 
    '❀', '❄'
  ];

  // Helper to pick random item
  function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Scramble character logic
  function scrambleChar(char) {
    const code = char.charCodeAt(0);
    // Hangul Syllables: U+AC00 to U+D7A3
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const randomCode = Math.floor(Math.random() * (0xD7A3 - 0xAC00 + 1)) + 0xAC00;
      return String.fromCharCode(randomCode);
    }
    // English uppercase
    if (char >= 'A' && char <= 'Z') {
      const randomCode = Math.floor(Math.random() * 26) + 65;
      return String.fromCharCode(randomCode);
    }
    // English lowercase
    if (char >= 'a' && char <= 'z') {
      const randomCode = Math.floor(Math.random() * 26) + 97;
      return String.fromCharCode(randomCode);
    }
    // Digits
    if (char >= '0' && char <= '9') {
      const randomCode = Math.floor(Math.random() * 10) + 48;
      return String.fromCharCode(randomCode);
    }
    // CJK Unified Ideographs (Chinese characters)
    if (code >= 0x4E00 && code <= 0x9FFF) {
      const randomCode = Math.floor(Math.random() * (0x9FFF - 0x4E00 + 1)) + 0x4E00;
      return String.fromCharCode(randomCode);
    }
    // Japanese Hiragana
    if (code >= 0x3040 && code <= 0x309F) {
      const randomCode = Math.floor(Math.random() * (0x309F - 0x3040 + 1)) + 0x3040;
      return String.fromCharCode(randomCode);
    }
    // Japanese Katakana
    if (code >= 0x30A0 && code <= 0x30FF) {
      const randomCode = Math.floor(Math.random() * (0x30FF - 0x30A0 + 1)) + 0x30A0;
      return String.fromCharCode(randomCode);
    }
    return char;
  }

  // Geometric shapes mapping
  function geometricChar(char) {
    const code = char.charCodeAt(0);
    if (
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z') ||
      (char >= '0' && char <= '9') ||
      (code >= 0xAC00 && code <= 0xD7A3) || // Hangul
      (code >= 0x4E00 && code <= 0x9FFF) || // Chinese
      (code >= 0x3040 && code <= 0x30FF)    // Kana/Hiragana
    ) {
      return getRandomElement(GEOMETRIC_SHAPES);
    }
    return char;
  }

  // Block redaction mapping
  function redactChar(char) {
    const code = char.charCodeAt(0);
    if (
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z') ||
      (char >= '0' && char <= '9') ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3040 && code <= 0x30FF)
    ) {
      return '█';
    }
    return char;
  }

  // Text obfuscator router
  function obfuscateTextByMode(text, mode) {
    if (mode === 'scramble') {
      return text.split('').map(scrambleChar).join('');
    } else if (mode === 'geometric') {
      return text.split('').map(geometricChar).join('');
    } else if (mode === 'block') {
      return text.split('').map(redactChar).join('');
    }
    return text;
  }

  // DOM node query to find all Text nodes inside a Selection range
  function getTextNodesInRange(range) {
    const textNodes = [];
    if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      textNodes.push(range.commonAncestorContainer);
      return textNodes;
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (range.intersectsNode(node)) {
            // Exclude script, style, and the extension host elements
            const parent = node.parentNode;
            if (parent) {
              const tag = parent.tagName.toLowerCase();
              if (['script', 'style', 'textarea', 'input', 'select', 'noscript'].includes(tag)) {
                return NodeFilter.FILTER_REJECT;
              }
              if (parent.closest('#anti-readability-host')) {
                return NodeFilter.FILTER_REJECT;
              }
            }
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let currentNode = walker.currentNode;
    if (currentNode.nodeType === Node.TEXT_NODE && range.intersectsNode(currentNode)) {
      textNodes.push(currentNode);
    }
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }
    return textNodes;
  }

  // Wrap a sub-segment of a Text node in a custom HTML tag (for Blur mode)
  function wrapTextNode(textNode, start, end, className) {
    const text = textNode.nodeValue;
    const beforeText = text.substring(0, start);
    const targetText = text.substring(start, end);
    const afterText = text.substring(end);

    const parent = textNode.parentNode;
    if (!parent) return null;

    const span = document.createElement('span');
    span.className = className;
    span.textContent = targetText;

    const beforeNode = beforeText ? document.createTextNode(beforeText) : null;
    const afterNode = afterText ? document.createTextNode(afterText) : null;

    const insertedNodes = [];
    // Insert new elements before removing the old one to maintain structure
    if (beforeNode) {
      parent.insertBefore(beforeNode, textNode);
      insertedNodes.push(beforeNode);
    }
    parent.insertBefore(span, textNode);
    insertedNodes.push(span);
    if (afterNode) {
      parent.insertBefore(afterNode, textNode);
      insertedNodes.push(afterNode);
    }

    parent.removeChild(textNode);

    return {
      type: 'wrap',
      parent: parent,
      originalNode: textNode,
      insertedNodes: insertedNodes
    };
  }

  // Undo a wrapped text node split
  function undoWrap(change) {
    if (!change.parent) return;
    // Insert back original text node
    change.parent.insertBefore(change.originalNode, change.insertedNodes[0]);
    // Remove split/wrapped nodes
    change.insertedNodes.forEach(node => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
  }

  // Redo a wrapped text node split
  function redoWrap(change) {
    if (!change.parent) return;
    const refNode = change.originalNode;
    change.insertedNodes.forEach(node => {
      change.parent.insertBefore(node, refNode);
    });
    if (refNode.parentNode) {
      refNode.parentNode.removeChild(refNode);
    }
  }

  // Unwrap a blurred text span to restore original layout
  function unwrapBlurSpan(span) {
    const parent = span.parentNode;
    if (!parent) return null;
    
    const childNodes = Array.from(span.childNodes);
    const nextSibling = span.nextSibling;
    
    childNodes.forEach(child => {
      parent.insertBefore(child, span);
    });
    
    parent.removeChild(span);
    
    return {
      type: 'unwrap',
      parent: parent,
      span: span,
      childNodes: childNodes,
      nextSibling: nextSibling
    };
  }

  // Undo a span unwrapping (re-wrap)
  function undoUnwrap(change) {
    if (!change.parent) return;
    change.parent.insertBefore(change.span, change.nextSibling);
    change.childNodes.forEach(child => {
      change.span.appendChild(child);
    });
  }

  // Redo a span unwrapping
  function redoUnwrap(change) {
    if (!change.parent) return;
    change.childNodes.forEach(child => {
      change.parent.insertBefore(child, change.span);
    });
    if (change.span.parentNode) {
      change.parent.removeChild(change.span);
    }
  }

  // Core function to obfuscate or restore current user selection
  function obfuscateSelection() {
    if (!isActive) return;
    
    const selection = window.getSelection();
    if (selection.isCollapsed || selection.rangeCount === 0) return;

    const transaction = [];
    
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      
      // Make sure selection is not inside the toolbar
      if (hostElement && hostElement.contains(range.commonAncestorContainer)) {
        continue;
      }

      // If in Restore mode, unwrap any intersecting blurred spans
      if (currentMode === 'restore') {
        const spans = Array.from(document.querySelectorAll('.obfuscated-blur')).filter(span => {
          return range.intersectsNode(span) && !hostElement.contains(span);
        });
        
        spans.forEach(span => {
          const change = unwrapBlurSpan(span);
          if (change) transaction.push(change);
        });
      }

      const textNodes = getTextNodesInRange(range);
      
      textNodes.forEach(node => {
        const start = (node === range.startContainer) ? range.startOffset : 0;
        const end = (node === range.endContainer) ? range.endOffset : node.nodeValue.length;
        
        if (start >= end) return;
        
        const text = node.nodeValue;
        const targetText = text.substring(start, end);
        if (targetText.trim() === '') return; // Skip empty nodes/whitespace

        if (currentMode === 'restore') {
          // Restore text from originalTextNodesMap
          if (originalTextNodesMap.has(node)) {
            const originalText = originalTextNodesMap.get(node);
            const newValue = text.substring(0, start) + originalText.substring(start, end) + text.substring(end);
            
            if (newValue !== text) {
              const change = {
                type: 'text',
                node: node,
                originalValue: text,
                newValue: newValue
              };
              node.nodeValue = newValue;
              transaction.push(change);
            }
          }
        } else if (currentMode === 'blur') {
          const change = wrapTextNode(node, start, end, 'obfuscated-blur');
          if (change) transaction.push(change);
        } else {
          const obfuscatedText = obfuscateTextByMode(targetText, currentMode);
          const newValue = text.substring(0, start) + obfuscatedText + text.substring(end);
          
          // Save the original text value BEFORE first modification
          if (!originalTextNodesMap.has(node)) {
            originalTextNodesMap.set(node, text);
          }

          const change = {
            type: 'text',
            node: node,
            originalValue: text,
            newValue: newValue
          };
          
          node.nodeValue = newValue;
          transaction.push(change);
        }
      });
    }

    if (transaction.length > 0) {
      undoHistory.push(transaction);
      redoHistory = []; // Clear redo stack on new action
      updateToolbarButtons();
      showToast(currentMode === 'restore' ? chrome.i18n.getMessage("toast_restore_success") : chrome.i18n.getMessage("toast_obfuscate_success"));
    }

    // Clear selection for a clean experience
    selection.removeAllRanges();
  }

  // Handle clicking on images inside Image Obfuscation mode or Restore mode
  function handleImageClick(e) {
    if (!isActive) return;
    
    // Check if target or parent of target is an img
    const img = e.target.closest('img');
    if (!img) return;
    
    // Prevent normal link clicks or image drag actions in these modes
    if (currentMode === 'image' || currentMode === 'restore') {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (currentMode === 'image') {
      // Do not blur already blurred images
      if (img.classList.contains('ar-obfuscated-image')) return;
      
      const originalFilter = img.style.filter;
      const originalPointerEvents = img.style.pointerEvents;
      
      // Save original filter BEFORE first modification
      if (!originalImagesMap.has(img)) {
        originalImagesMap.set(img, originalFilter || '');
      }
      
      img.classList.add('ar-obfuscated-image');
      img.style.filter = 'blur(20px) grayscale(50%)';
      
      const change = {
        type: 'image',
        node: img,
        originalFilter: originalFilter,
        originalPointerEvents: originalPointerEvents,
        newValue: 'blur(20px) grayscale(50%)'
      };
      
      undoHistory.push([change]);
      redoHistory = []; // Clear redo stack
      updateToolbarButtons();
      showToast(chrome.i18n.getMessage("toast_image_obfuscate"));
    } else if (currentMode === 'restore') {
      // If clicked a blurred image, restore it
      if (img.classList.contains('ar-obfuscated-image')) {
        const currentFilter = img.style.filter;
        const originalFilter = originalImagesMap.has(img) ? originalImagesMap.get(img) : '';
        
        img.classList.remove('ar-obfuscated-image');
        img.style.filter = originalFilter;
        
        const change = {
          type: 'image_restore',
          node: img,
          originalFilter: currentFilter, // blurred state for undo
          newValue: originalFilter // restored state
        };
        
        undoHistory.push([change]);
        redoHistory = []; // Clear redo stack
        updateToolbarButtons();
        showToast(chrome.i18n.getMessage("toast_image_restore"));
      }
    }
  }

  // Restore entire page (Helper for entire page restore)
  function restoreEntirePage() {
    const transaction = [];
    
    // 1. Restore all modified text nodes
    originalTextNodesMap.forEach((originalText, node) => {
      const currentText = node.nodeValue;
      if (currentText !== originalText) {
        transaction.push({
          type: 'text',
          node: node,
          originalValue: currentText,
          newValue: originalText
        });
        node.nodeValue = originalText;
      }
    });
    
    // 2. Restore all blurred spans
    const spans = Array.from(document.querySelectorAll('.obfuscated-blur')).filter(span => {
      return !hostElement.contains(span);
    });
    spans.forEach(span => {
      const change = unwrapBlurSpan(span);
      if (change) transaction.push(change);
    });
    
    // 3. Restore all blurred images
    const imgs = Array.from(document.querySelectorAll('.ar-obfuscated-image')).filter(img => {
      return !hostElement.contains(img);
    });
    imgs.forEach(img => {
      const currentFilter = img.style.filter;
      const originalFilter = originalImagesMap.has(img) ? originalImagesMap.get(img) : '';
      
      img.classList.remove('ar-obfuscated-image');
      img.style.filter = originalFilter;
      
      transaction.push({
        type: 'image_restore',
        node: img,
        originalFilter: currentFilter,
        newValue: originalFilter
      });
    });
    
    if (transaction.length > 0) {
      undoHistory.push(transaction);
      redoHistory = [];
      updateToolbarButtons();
      showToast(chrome.i18n.getMessage("toast_page_restore"));
    }
  }

  // Obfuscate entire page
  function obfuscateEntirePage() {
    if (!isActive) return;

    if (currentMode === 'restore') {
      restoreEntirePage();
      return;
    }

    if (currentMode === 'image') {
      const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
        // Skip extension internal icons and already blurred images
        return !hostElement.contains(img) && !img.classList.contains('ar-obfuscated-image');
      });

      const transaction = [];
      imgs.forEach(img => {
        const originalFilter = img.style.filter;
        const originalPointerEvents = img.style.pointerEvents;
        
        // Save original filter BEFORE first modification
        if (!originalImagesMap.has(img)) {
          originalImagesMap.set(img, originalFilter || '');
        }

        img.classList.add('ar-obfuscated-image');
        img.style.filter = 'blur(20px) grayscale(50%)';
        
        transaction.push({
          type: 'image',
          node: img,
          originalFilter: originalFilter,
          originalPointerEvents: originalPointerEvents,
          newValue: 'blur(20px) grayscale(50%)'
        });
      });

      if (transaction.length > 0) {
        undoHistory.push(transaction);
        redoHistory = [];
        updateToolbarButtons();
        showToast(chrome.i18n.getMessage("toast_page_image_obfuscate"));
      }
      return;
    }

    // Search for all text nodes under body
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'textarea', 'input', 'select', 'noscript'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('#anti-readability-host')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.nodeValue.trim() === '') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    const transaction = [];
    textNodes.forEach(node => {
      const originalText = node.nodeValue;
      if (currentMode === 'blur') {
        const change = wrapTextNode(node, 0, originalText.length, 'obfuscated-blur');
        if (change) transaction.push(change);
      } else {
        const newValue = obfuscateTextByMode(originalText, currentMode);
        const change = {
          type: 'text',
          node: node,
          originalValue: originalText,
          newValue: newValue
        };

        // Cache original value
        if (!originalTextNodesMap.has(node)) {
          originalTextNodesMap.set(node, originalText);
        }

        node.nodeValue = newValue;
        transaction.push(change);
      }
    });

    if (transaction.length > 0) {
      undoHistory.push(transaction);
      redoHistory = [];
      updateToolbarButtons();
      showToast(chrome.i18n.getMessage("toast_page_obfuscate"));
    }
  }

  // Undo last action
  function undo() {
    if (undoHistory.length === 0) return;
    const transaction = undoHistory.pop();
    
    // Undo in reverse order of modifications
    for (let i = transaction.length - 1; i >= 0; i--) {
      const change = transaction[i];
      if (change.type === 'text') {
        change.node.nodeValue = change.originalValue;
      } else if (change.type === 'wrap') {
        undoWrap(change);
      } else if (change.type === 'unwrap') {
        undoUnwrap(change);
      } else if (change.type === 'image') {
        change.node.classList.remove('ar-obfuscated-image');
        change.node.style.filter = change.originalFilter;
      } else if (change.type === 'image_restore') {
        change.node.classList.add('ar-obfuscated-image');
        change.node.style.filter = change.originalFilter; // Restore blurred filter
      }
    }
    
    redoHistory.push(transaction);
    updateToolbarButtons();
    showToast(chrome.i18n.getMessage("toast_undo"));
  }

  // Redo last undone action
  function redo() {
    if (redoHistory.length === 0) return;
    const transaction = redoHistory.pop();
    
    transaction.forEach(change => {
      if (change.type === 'text') {
        change.node.nodeValue = change.newValue;
      } else if (change.type === 'wrap') {
        redoWrap(change);
      } else if (change.type === 'unwrap') {
        redoUnwrap(change);
      } else if (change.type === 'image') {
        change.node.classList.add('ar-obfuscated-image');
        change.node.style.filter = change.newValue;
      } else if (change.type === 'image_restore') {
        change.node.classList.remove('ar-obfuscated-image');
        change.node.style.filter = change.newValue; // Restore unblurred original
      }
    });
    
    undoHistory.push(transaction);
    updateToolbarButtons();
    showToast(chrome.i18n.getMessage("toast_redo"));
  }

  // Update Toolbar UI state (Undo/Redo button disabled states)
  function updateToolbarButtons() {
    if (!shadowRoot) return;
    const undoBtn = shadowRoot.getElementById('ar-undo');
    const redoBtn = shadowRoot.getElementById('ar-redo');

    if (undoBtn) {
      undoBtn.disabled = undoHistory.length === 0;
    }
    if (redoBtn) {
      redoBtn.disabled = redoHistory.length === 0;
    }
  }

  // Drag handler for toolbar
  function setupDragging(dragHandle, toolbar) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;

    dragHandle.addEventListener('mousedown', (e) => {
      // Ignore right clicks or clicks on buttons inside dragHandle if any
      if (e.button !== 0 || e.target.closest('button')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = toolbar.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      e.preventDefault();
      
      // Instantly switch from transform-centered bottom positioning to absolute pixel coords to prevent jumping
      toolbar.style.transition = 'none';
      toolbar.style.transform = 'none';
      toolbar.style.bottom = 'auto';
      toolbar.style.right = 'auto';
      toolbar.style.left = `${initialLeft}px`;
      toolbar.style.top = `${initialTop}px`;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;
      
      // Prevent toolbar from moving outside viewport boundaries
      const padding = 10;
      newLeft = Math.max(padding, Math.min(window.innerWidth - toolbar.offsetWidth - padding, newLeft));
      newTop = Math.max(padding, Math.min(window.innerHeight - toolbar.offsetHeight - padding, newTop));
      
      toolbar.style.left = `${newLeft}px`;
      toolbar.style.top = `${newTop}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        toolbar.style.transition = ''; // Restore transitions
      }
    });
  }

  // Build and inject floating toolbar inside Shadow DOM
  function createToolbar() {
    if (hostElement) return;

    // 1. Create main host element
    hostElement = document.createElement('div');
    hostElement.id = 'anti-readability-host';
    hostElement.style.position = 'fixed';
    hostElement.style.top = '0';
    hostElement.style.left = '0';
    hostElement.style.width = '0';
    hostElement.style.height = '0';
    hostElement.style.zIndex = '2147483647';
    document.body.appendChild(hostElement);

    // 2. Create shadow root to fully isolate styles
    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    // 3. Inject styles directly inside Shadow DOM to comply with Manifest V3 security
    const style = document.createElement('style');
    style.textContent = `
      .ar-toolbar {
        position: fixed;
        z-index: 2147483647;
        height: 52px !important;
        background: rgba(15, 23, 42, 0.88) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 26px !important;
        box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6), 0 10px 15px -5px rgba(0, 0, 0, 0.3) !important;
        color: #f1f5f9 !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
        font-size: 13px !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        padding: 0 6px !important;
        gap: 8px !important;
        user-select: none !important;
        transition: opacity 0.2s ease, transform 0.2s ease !important;
        box-sizing: border-box !important;
      }
      .ar-toolbar * {
        box-sizing: border-box !important;
      }
      .ar-drag-handle {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding-left: 12px !important;
        padding-right: 4px !important;
        color: #64748b !important;
        cursor: grab !important;
        transition: color 0.2s !important;
      }
      .ar-drag-handle:hover {
        color: #94a3b8 !important;
      }
      .ar-drag-handle:active {
        cursor: grabbing !important;
      }
      .ar-drag-handle svg {
        width: 10px !important;
        height: 16px !important;
        fill: currentColor !important;
      }
      .ar-brand-group {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding-right: 4px !important;
      }
      .ar-logo-dot {
        width: 8px;
        height: 8px;
        background: #38bdf8;
        border-radius: 50%;
        box-shadow: 0 0 8px #38bdf8;
        animation: ar-pulse-cyan 2s infinite;
      }
      @keyframes ar-pulse-cyan {
        0% { transform: scale(0.9); opacity: 0.6; }
        50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 12px #38bdf8; }
        100% { transform: scale(0.9); opacity: 0.6; }
      }
      .ar-brand-name {
        font-weight: 700 !important;
        font-size: 12px !important;
        letter-spacing: 0.5px !important;
        color: #e2e8f0 !important;
      }
      .ar-divider {
        width: 1px !important;
        height: 20px !important;
        background: rgba(255, 255, 255, 0.12) !important;
      }
      .ar-modes-segment {
        display: flex !important;
        gap: 4px !important;
      }
      .ar-segment-btn {
        background: transparent !important;
        border: 1px solid transparent !important;
        border-radius: 20px !important;
        padding: 6px 12px !important;
        color: #94a3b8 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        transition: all 0.2s ease !important;
        white-space: nowrap !important;
      }
      .ar-segment-btn:hover {
        background: rgba(255, 255, 255, 0.05) !important;
        color: #cbd5e1 !important;
      }
      .ar-segment-btn.active {
        background: rgba(56, 189, 248, 0.12) !important;
        border-color: rgba(56, 189, 248, 0.2) !important;
        color: #38bdf8 !important;
        box-shadow: 0 2px 8px rgba(56, 189, 248, 0.05) !important;
      }
      .ar-segment-btn svg {
        width: 15px !important;
        height: 15px !important;
        fill: currentColor !important;
      }
      .ar-actions-group {
        display: flex !important;
        gap: 4px !important;
      }
      .ar-action-btn {
        width: 32px !important;
        height: 32px !important;
        border-radius: 50% !important;
        background: rgba(30, 41, 59, 0.4) !important;
        border: 1px solid rgba(255, 255, 255, 0.05) !important;
        color: #cbd5e1 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.2s ease !important;
      }
      .ar-action-btn:hover:not(:disabled) {
        background: rgba(30, 41, 59, 0.8) !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
        color: #38bdf8 !important;
        transform: scale(1.05) !important;
      }
      .ar-action-btn:active:not(:disabled) {
        transform: scale(0.95) !important;
      }
      .ar-action-btn:disabled {
        opacity: 0.25 !important;
        cursor: not-allowed !important;
      }
      .ar-action-btn svg {
        width: 14px !important;
        height: 14px !important;
        fill: currentColor !important;
      }
      .ar-finish-btn {
        background: linear-gradient(135deg, #06b6d4, #0891b2) !important;
        border: none !important;
        border-radius: 20px !important;
        padding: 6px 14px !important;
        color: #ffffff !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 12px !important;
        box-shadow: 0 4px 12px rgba(6, 182, 212, 0.25) !important;
        transition: all 0.2s ease !important;
        margin-right: 6px !important;
        white-space: nowrap !important;
      }
      .ar-finish-btn:hover {
        transform: scale(1.03) !important;
        box-shadow: 0 6px 16px rgba(6, 182, 212, 0.4) !important;
        filter: brightness(1.05) !important;
      }
      .ar-finish-btn:active {
        transform: scale(0.97) !important;
      }
      .ar-finish-btn svg {
        width: 14px !important;
        height: 14px !important;
        fill: currentColor !important;
      }
      .ar-toast-container {
        position: fixed !important;
        bottom: 96px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(20px) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        background: rgba(15, 23, 42, 0.9) !important;
        border: 1px solid rgba(56, 189, 248, 0.2) !important;
        border-radius: 30px !important;
        padding: 10px 20px !important;
        color: #38bdf8 !important;
        font-weight: 500 !important;
        font-size: 12px !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5) !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        z-index: 2147483647 !important;
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
        white-space: nowrap !important;
      }
      .ar-toast-container.visible {
        transform: translateX(-50%) translateY(0) !important;
        opacity: 1 !important;
      }
    `;
    shadowRoot.appendChild(style);

    // 4. Create Toolbar Div (Horizontal Pill Capsule centered at bottom)
    toolbarElement = document.createElement('div');
    toolbarElement.className = 'ar-toolbar';
    toolbarElement.style.bottom = '30px';
    toolbarElement.style.left = '50%';
    toolbarElement.style.transform = 'translateX(-50%) translateY(20px)';
    toolbarElement.style.opacity = '0';

    // Trigger smooth fade-in and slide-up micro-interaction
    setTimeout(() => {
      if (toolbarElement) {
        toolbarElement.style.opacity = '1';
        toolbarElement.style.transform = 'translateX(-50%)';
      }
    }, 50);

    // Horizontal Capsule Toolbar Inner HTML
    toolbarElement.innerHTML = `
      <div class="ar-drag-handle" title="${chrome.i18n.getMessage('toolbar_drag_title')}">
        <svg viewBox="0 0 12 20" fill="none">
          <circle cx="2" cy="2" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="6" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="14" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="18" r="1.5" fill="currentColor"/>
          <circle cx="6" cy="2" r="1.5" fill="currentColor"/>
          <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
          <circle cx="6" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="6" cy="14" r="1.5" fill="currentColor"/>
          <circle cx="6" cy="18" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      
      <div class="ar-brand-group">
        <div class="ar-logo-dot"></div>
        <span class="ar-brand-name">AntiRead</span>
      </div>

      <div class="ar-divider"></div>

      <div class="ar-modes-segment">
        <button class="ar-segment-btn active" data-mode="scramble" title="${chrome.i18n.getMessage('mode_scramble_title')}">
          <svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.45 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_scramble')}</span>
        </button>
        <button class="ar-segment-btn" data-mode="geometric" title="${chrome.i18n.getMessage('mode_geometric_title')}">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5" /><circle cx="17" cy="7" r="4.5" /><polygon points="12,13 6,21 18,21" /></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_geometric')}</span>
        </button>
        <button class="ar-segment-btn" data-mode="block" title="${chrome.i18n.getMessage('mode_block_title')}">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_block')}</span>
        </button>
        <button class="ar-segment-btn" data-mode="blur" title="${chrome.i18n.getMessage('mode_blur_title')}">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" opacity="0.3" /><circle cx="12" cy="12" r="6" opacity="0.6" /><circle cx="12" cy="12" r="3" /></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_blur')}</span>
        </button>
        <button class="ar-segment-btn" data-mode="image" title="${chrome.i18n.getMessage('mode_image_title')}">
          <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1zm-4.44-6.19l-3 3.86L8.5 14.5l-3 4h13l-3.94-5.19z"/></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_image')}</span>
        </button>
        <button class="ar-segment-btn" data-mode="restore" title="${chrome.i18n.getMessage('mode_restore_title')}">
          <svg viewBox="0 0 24 24"><path d="M16.24 7.56l.01-.01c.39-.39 1.02-.39 1.41 0l2.83 2.83c.39.39.39 1.02 0 1.41l-8.59 8.59c-.39.39-1.02.39-1.41 0l-2.83-2.83c-.39-.39-.39-1.02 0-1.41l8.59-8.59zm-8.58 9.27L10.37 14 14 17.63l-2.71 2.71c-.39.39-1.02.39-1.41 0l-2.83-2.83c-.39-.38-.39-1.01 0-1.41c.01.02.01.02 0 0zm-3.37 3.17H21v-2H10.59l-2.82 2z"/></svg>
          <span class="ar-btn-label">${chrome.i18n.getMessage('mode_restore')}</span>
        </button>
      </div>

      <div class="ar-divider"></div>

      <div class="ar-actions-group">
        <button class="ar-action-btn" id="ar-undo" disabled title="${chrome.i18n.getMessage('toolbar_undo_title')}">
          <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
        </button>
        <button class="ar-action-btn" id="ar-redo" disabled title="${chrome.i18n.getMessage('toolbar_redo_title')}">
          <svg viewBox="0 0 24 24"><path d="M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.97 7.22l2.37.78c1.05-3.19 4.06-5.5 7.6-5.5 1.96 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
        </button>
        <button class="ar-action-btn" id="ar-obfuscate-all" title="${chrome.i18n.getMessage('toolbar_all_title')}">
          <svg viewBox="0 0 24 24"><path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8l-2.5-1.4 1.4 2.5-1.4 2.5 2.5-1.4 2.5 1.4-1.4-2.5 1.4-2.5zm0-9.2l-2.5-1.4 1.4 2.5-1.4 2.5 2.5-1.4 2.5 1.4-1.4-2.5 1.4-2.5zM3 21h3.75L17.81 9.94l-3.75-3.75L3 17.25V21zm17.71-12.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
      </div>

      <div class="ar-divider"></div>

      <button class="ar-finish-btn" id="ar-finish" title="${chrome.i18n.getMessage('toolbar_finish_title')}">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        <span>${chrome.i18n.getMessage('toolbar_finish')}</span>
      </button>
    `;

    shadowRoot.appendChild(toolbarElement);

    // 5. Create Toast Notification Element
    toastElement = document.createElement('div');
    toastElement.className = 'ar-toast-container';
    toastElement.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      <span class="ar-toast-text">${chrome.i18n.getMessage('extName')}</span>
    `;
    shadowRoot.appendChild(toastElement);

    // Set up dragging using the dedicated handle
    const dragHandle = shadowRoot.querySelector('.ar-drag-handle');
    setupDragging(dragHandle, toolbarElement);

    // Bind Event Listeners for segmented buttons inside Shadow DOM
    const modeButtons = shadowRoot.querySelectorAll('.ar-segment-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const clickedBtn = e.currentTarget;
        modeButtons.forEach(b => b.classList.remove('active'));
        clickedBtn.classList.add('active');
        
        currentMode = clickedBtn.getAttribute('data-mode');
        updateBodyClasses(); // Apply specific pointer events / outlines dynamically
        showToast(chrome.i18n.getMessage("toast_mode_change") + clickedBtn.querySelector('.ar-btn-label').textContent);
      });
    });

    shadowRoot.getElementById('ar-undo').addEventListener('click', undo);
    shadowRoot.getElementById('ar-redo').addEventListener('click', redo);
    shadowRoot.getElementById('ar-obfuscate-all').addEventListener('click', obfuscateEntirePage);
    shadowRoot.getElementById('ar-finish').addEventListener('click', deactivate);
  }

  // Clean up floating toolbar
  function removeToolbar() {
    if (hostElement) {
      toolbarElement.style.opacity = '0';
      // Simple vertical slide down animation for closing, works regardless of horizontal position
      toolbarElement.style.transform = (toolbarElement.style.left === '50%') ? 
        'translateX(-50%) translateY(20px)' : 'translateY(20px)';
      
      setTimeout(() => {
        if (hostElement && hostElement.parentNode) {
          hostElement.parentNode.removeChild(hostElement);
        }
        hostElement = null;
        shadowRoot = null;
        toolbarElement = null;
        toastElement = null;
      }, 200);
    }
  }

  // Toast message controller
  function showToast(message) {
    if (!toastElement) return;
    
    const textNode = toastElement.querySelector('.ar-toast-text');
    if (textNode) {
      textNode.textContent = message;
    }

    toastElement.classList.add('visible');
    
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    
    toastTimeout = setTimeout(() => {
      if (toastElement) {
        toastElement.classList.remove('visible');
      }
    }, 4500);
  }

  // Keyboard shortcut listener (Ctrl+Z and Ctrl+Y)
  function handleKeyDown(e) {
    if (!isActive) return;

    // Detect Ctrl+Z (Undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    // Detect Ctrl+Y (Redo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }

  // Helper to manage body class tags dynamically
  function updateBodyClasses() {
    if (!isActive) {
      document.body.classList.remove('ar-active-mode');
      document.body.classList.remove('ar-mode-image');
      document.body.classList.remove('ar-mode-restore');
      return;
    }
    
    document.body.classList.add('ar-active-mode');
    
    if (currentMode === 'image') {
      document.body.classList.add('ar-mode-image');
      document.body.classList.remove('ar-mode-restore');
    } else if (currentMode === 'restore') {
      document.body.classList.remove('ar-mode-image');
      document.body.classList.add('ar-mode-restore');
    } else {
      document.body.classList.remove('ar-mode-image');
      document.body.classList.remove('ar-mode-restore');
    }
  }

  // Main activate handler
  function activate() {
    if (isActive) {
      showToast(chrome.i18n.getMessage("toast_activated_already"));
      return;
    }
    isActive = true;

    // Update body classes
    updateBodyClasses();
    
    // Read default mode from storage if set
    chrome.storage.local.get(['defaultMode'], (result) => {
      if (result.defaultMode && ['scramble', 'geometric', 'block', 'blur', 'image', 'restore'].includes(result.defaultMode)) {
        currentMode = result.defaultMode;
        
        // Update active class in toolbar buttons
        if (shadowRoot) {
          const modeButtons = shadowRoot.querySelectorAll('.ar-segment-btn');
          modeButtons.forEach(btn => {
            if (btn.getAttribute('data-mode') === currentMode) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
        }
        updateBodyClasses();
      }
    });

    createToolbar();
    
    // Bind selection and click handlers on the page
    document.addEventListener('mouseup', obfuscateSelection);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleImageClick, true); // Capture phase click interception
    
    // Load active mode button style
    setTimeout(() => {
      if (shadowRoot) {
        const modeButtons = shadowRoot.querySelectorAll('.ar-segment-btn');
        modeButtons.forEach(btn => {
          if (btn.getAttribute('data-mode') === currentMode) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }
      showToast(chrome.i18n.getMessage("toast_activated_welcome"));
    }, 100);
  }

  // Main deactivate handler
  function deactivate() {
    if (!isActive) return;
    isActive = false;

    // Reset body classes
    updateBodyClasses();
    
    // Unbind event listeners
    document.removeEventListener('mouseup', obfuscateSelection);
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('click', handleImageClick, true);
    
    // Remove Selection
    const selection = window.getSelection();
    selection.removeAllRanges();
    
    removeToolbar();
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ping") {
      sendResponse({ status: "pong" });
    } else if (message.action === "activate") {
      activate();
      sendResponse({ status: "activated" });
    }
  });

})();
