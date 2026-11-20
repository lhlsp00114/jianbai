import { apertureDescription, cameraOptions, focalLengthDescription, isCameraSettings, lensOptions } from "./cameraOptions";

export function getCameraPrompt(value: unknown): string {
  if (!isCameraSettings(value) || !value.enabled) return "";
  const camera = cameraOptions.find(item => item.id === value.camera)!;
  const lens = lensOptions.find(item => item.id === value.lens)!;
  return `摄影参数指导：相机参考 ${camera.label}；镜头 ${lens.label}；焦距 ${value.focalLength} mm（全画幅等效视角）；光圈 f/${value.aperture}。${camera.prompt}。${lens.prompt}。${focalLengthDescription(value.focalLength)}${apertureDescription(value.aperture)}根据拍摄距离和场景尺度合理表现景深，主体关键部位保持清晰。上述参数作为视觉风格与取景指导，不强制模拟真实器材组合；保留用户指定的主体、场景、动作与构图，摄影风格不覆盖用户明确指定的配色，不在画面中添加相机、参数标签或水印。`;
}

export { isCameraSettings };
