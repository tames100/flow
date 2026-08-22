import { ref } from "vue";

/** 限制大小，避免 localStorage 溢出（默认 1.5MB） */
const MAX_SIZE = 1.5 * 1024 * 1024;

/** 将图片 File 读取为 dataURL（供属性图标等场景复用） */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    if (file.size > MAX_SIZE) {
      reject(new Error("图片过大，请控制在 1.5MB 以内"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 判断图标值是否为图片（dataURL / http(s) / blob），否则按文字/emoji 展示 */
export function isImageIcon(value: string): boolean {
  return /^(data:image\/|https?:\/\/|blob:)/i.test(value);
}

/** 从文件名提取基础名称（去除扩展名），如 葡萄.png → 葡萄 */
export function fileBaseName(file: File): string {
  const name = file.name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * useImageUpload —— 统一处理本地图片上传（文件选择 / 拖拽）→ dataURL。
 * 不再支持剪贴板粘贴，确保图片均来自用户主动上传。
 */
export function useImageUpload() {
  const image = ref("");
  const fileInput = ref<HTMLInputElement | null>(null);

  /** 处理单个 File（拖拽 / 文件选择共用） */
  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    try {
      image.value = await fileToDataURL(file);
    } catch (e) {
      console.warn(e);
    }
  }

  /** 点击按钮选择本地文件 */
  function openPicker() {
    fileInput.value?.click();
  }
  function onFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    handleFile(file);
    target.value = ""; // 允许重复选择同一文件
  }

  /** 拖拽放置 */
  function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  }

  function reset() {
    image.value = "";
  }

  return {
    image,
    fileInput,
    openPicker,
    onFileChange,
    onDrop,
    handleFile,
    reset,
  };
}
