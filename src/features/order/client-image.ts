export type ImageDraft = {
  localId: string;
  file: File;
  preview: string;
  width: number;
  height: number;
};

async function decodeImage(file: File) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      /* Safari fallback below */
    }
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () =>
      reject(new Error("이 이미지 형식은 변환할 수 없어요."));
    element.src = url;
  });
  return {
    source: image as CanvasImageSource,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export async function prepareImage(original: File): Promise<ImageDraft> {
  if (original.size > 10 * 1024 * 1024)
    throw new Error(`${original.name}: 원본은 10MB 이하만 선택할 수 있어요.`);
  const decoded = await decodeImage(original);
  try {
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 처리하지 못했어요.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    let quality = 0.86;
    let blob: Blob | null = null;
    while (quality >= 0.5) {
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= 2 * 1024 * 1024) break;
      quality -= 0.1;
    }
    if (!blob || blob.size > 2 * 1024 * 1024)
      throw new Error(`${original.name}: 2MB 이하로 압축하지 못했어요.`);
    const name = `${original.name.replace(/\.[^.]+$/, "") || "reference"}.jpg`;
    const file = new File([blob], name, { type: "image/jpeg" });
    return {
      localId: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      width,
      height,
    };
  } finally {
    decoded.cleanup();
  }
}
