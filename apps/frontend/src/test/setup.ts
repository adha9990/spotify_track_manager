import "@testing-library/jest-dom/vitest";

// jsdom 缺這些，Radix Dialog / user-event 會用到
const proto = Element.prototype as unknown as {
  scrollIntoView?: () => void;
  hasPointerCapture?: () => boolean;
  setPointerCapture?: () => void;
  releasePointerCapture?: () => void;
};
proto.scrollIntoView ??= () => {};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
