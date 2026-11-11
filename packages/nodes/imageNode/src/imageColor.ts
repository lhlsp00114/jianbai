export const colorSections = [
  { label: "光线", controls: [
    { key: "exposure", label: "曝光", min: -100 }, { key: "contrast", label: "对比度", min: -100 },
    { key: "highlights", label: "高光", min: -100 }, { key: "shadows", label: "阴影", min: -100 },
    { key: "whites", label: "白色", min: -100 }, { key: "blacks", label: "黑色", min: -100 },
  ] },
  { label: "颜色", controls: [
    { key: "temperature", label: "色温", min: -100 }, { key: "tint", label: "色调", min: -100 },
    { key: "vibrance", label: "自然饱和度", min: -100 }, { key: "saturation", label: "饱和度", min: -100 },
  ] },
  { label: "细节", controls: [
    { key: "texture", label: "纹理", min: -100 }, { key: "clarity", label: "清晰度", min: -100 },
    { key: "sharpen", label: "锐化", min: 0 }, { key: "denoise", label: "降噪", min: 0 },
    { key: "colorDenoise", label: "色彩降噪", min: 0 },
  ] },
  { label: "效果", controls: [
    { key: "dehaze", label: "去雾", min: -100 }, { key: "vignette", label: "暗角", min: -100 },
    { key: "grain", label: "颗粒", min: 0 }, { key: "fade", label: "褪色", min: -100 },
    { key: "blur", label: "模糊", min: 0 },
  ] },
] as const;

export type ColorSettings = Record<typeof colorSections[number]["controls"][number]["key"], number>;

export function createColorSettings(): ColorSettings {
  return Object.fromEntries(colorSections.flatMap(section => section.controls.map(control => [control.key, 0]))) as ColorSettings;
}

// ACT: 细节与降噪采用局部亮度/色度近似，并非专业降噪；后续可替换此滤镜，保留参数接口。
// 预览与导出共享处理顺序，空间半径统一按原图像素换算。
const fragmentSource = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 imageSize;
uniform vec4 light;
uniform vec2 ends;
uniform vec4 color;
uniform vec4 detail;
uniform float colorDenoise;
uniform vec4 effects;
uniform bool premultiplyOutput;

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 neighborhood(float radius, vec3 fallback) {
  vec3 sum = vec3(0.0);
  float weights = 0.0;
  vec2 stepSize = vec2(radius) / imageSize;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 sampleColor = texture2D(image, clamp(uv + vec2(float(x), float(y)) * stepSize, vec2(0.0), vec2(1.0)));
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) * sampleColor.a;
      sum += sampleColor.rgb * weight;
      weights += weight;
    }
  }
  return weights > 0.0001 ? sum / weights : fallback;
}

void main() {
  vec4 original = texture2D(image, uv);
  vec3 c = original.rgb;
  float luma = luminance(c);
  if (detail != vec4(0.0) || colorDenoise != 0.0) {
    vec3 fine = neighborhood(2.0, c);
    float fineLuma = luminance(fine);
    float edgeWeight = 1.0 - smoothstep(0.02, 0.22, abs(luma - fineLuma));
    c += vec3((fineLuma - luma) * detail.w * edgeWeight);
    c = mix(c, vec3(luminance(c)) + fine - vec3(fineLuma), colorDenoise * edgeWeight);
    c += vec3((luma - fineLuma) * detail.z * 1.8);
    if (detail.x != 0.0) c += vec3((luma - luminance(neighborhood(6.0, original.rgb))) * detail.x * 1.2);
    if (detail.y != 0.0) {
      float localLuma = luminance(neighborhood(18.0, original.rgb));
      c += vec3((luma - localLuma) * detail.y * 1.8 * (1.0 - abs(2.0 * luma - 1.0)));
    }
  }
  c = max(c, vec3(0.0));
  if (light.x != 0.0) {
    vec3 linearColor = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
    linearColor *= pow(2.0, light.x * 2.0);
    c = mix(linearColor * 12.92, 1.055 * pow(linearColor, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linearColor));
  }
  luma = clamp(luminance(c), 0.0, 1.0);
  float highlightMask = smoothstep(0.35, 1.0, luma);
  float shadowMask = 1.0 - smoothstep(0.0, 0.65, luma);
  c += vec3(light.z * highlightMask * 0.4 + light.w * shadowMask * 0.4);
  c += vec3(ends.x * pow(luma, 3.0) * 0.35 + ends.y * pow(1.0 - luma, 3.0) * 0.35);
  c = (c - 0.5) * (1.0 + light.y * 0.8) + 0.5;
  c += vec3(color.x * 0.13 + color.y * 0.05, -color.y * 0.10, -color.x * 0.13 + color.y * 0.05);
  float saturation = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(luminance(c)), c, max(0.0, (1.0 + color.w) * (1.0 + color.z * (1.0 - clamp(saturation, 0.0, 1.0)))));
  if (effects.x > 0.0) c = (c - 0.12 * effects.x) / (1.0 - 0.32 * effects.x);
  else c = mix(c, vec3(0.65), -effects.x * 0.35);
  float corner = smoothstep(0.25, 0.72, length(uv - 0.5));
  if (effects.y >= 0.0) c *= 1.0 - corner * effects.y * 0.85;
  else c = mix(c, vec3(1.0), corner * -effects.y * 0.6);
  if (effects.w >= 0.0) c = mix(c, c * 0.7 + 0.18, effects.w);
  else c = (c - 0.12 * -effects.w) / (1.0 - 0.24 * -effects.w);
  vec2 grainPixel = floor(uv * imageSize / 2.0);
  float noise = fract(sin(dot(grainPixel, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += noise * effects.z * 0.20;
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(premultiplyOutput ? c * original.a : c, original.a);
}
`;

// 连续高斯核截取到 3σ；合并相邻像素的权重，利用线性采样减少读取次数，不拉开采样间隔。
const gaussianSource = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 direction;
uniform vec2 taps[34];
uniform int tapCount;
uniform bool unpremultiplyOutput;
void main() {
  vec4 result = texture2D(image, uv) * taps[0].y;
  for (int i = 1; i < 34; i++) {
    if (i >= tapCount) break;
    vec2 offset = direction * taps[i].x;
    result += (texture2D(image, uv + offset) + texture2D(image, uv - offset)) * taps[i].y;
  }
  if (unpremultiplyOutput) result.rgb = result.a > 0.00001 ? result.rgb / result.a : vec3(0.0);
  gl_FragColor = result;
}
`;

function gaussianTaps(sigma: number) {
  const radius = Math.min(66, Math.ceil(sigma * 3));
  const weights = Array.from({ length: radius + 1 }, (_, index) => Math.exp(-index * index / (2 * sigma * sigma)));
  const total = 1 + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0);
  const taps = new Float32Array(68);
  taps[1] = 1 / total;
  let count = 1;
  for (let index = 1; index <= radius; index += 2) {
    const first = weights[index]!;
    const second = weights[index + 1] ?? 0;
    const weight = first + second;
    if (!weight) continue;
    taps[count * 2] = index + second / weight;
    taps[count * 2 + 1] = weight / total;
    count++;
  }
  return { taps, count };
}

export function createColorRenderer(canvas: HTMLCanvasElement, source: HTMLImageElement, width: number, height: number) {
  if (!source.complete || !source.naturalWidth || !source.naturalHeight || width < 1 || height < 1) throw new Error("图片尚未加载完成");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!context) throw new Error("当前浏览器无法启用图片调色，请开启硬件加速后重试");
  const gl = context;
  let program: WebGLProgram | null = null;
  let gaussianProgram: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  const shaders: WebGLShader[] = [];
  const blurTargets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];
  let blurWidth = 0;
  let blurHeight = 0;
  const dispose = () => {
    blurTargets.forEach(target => {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    });
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteProgram(gaussianProgram);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    if (width > Math.min(maxTextureSize, maxViewport[0]!) || height > Math.min(maxTextureSize, maxViewport[1]!)) throw new Error("图片尺寸超出当前设备调色上限，请先缩小图片");
    function compileShader(type: number, code: string) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("无法创建调色渲染器");
      shaders.push(shader);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("当前设备不支持图片调色渲染");
      return shader;
    }
    const vertex = compileShader(gl.VERTEX_SHADER, "attribute vec2 position; varying vec2 uv; void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }");
    function createProgram(fragment: string) {
      const shader = compileShader(gl.FRAGMENT_SHADER, fragment);
      const result = gl.createProgram();
      if (!result) throw new Error("无法创建调色渲染器");
      gl.attachShader(result, vertex);
      gl.attachShader(result, shader);
      gl.bindAttribLocation(result, 0, "position");
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
        gl.deleteProgram(result);
        throw new Error("调色渲染器初始化失败");
      }
      return result;
    }
    program = createProgram(fragmentSource);
    gaussianProgram = createProgram(gaussianSource);
    gl.useProgram(program);
    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error("图片调色内存不足");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
    gl.uniform2f(gl.getUniformLocation(program, "imageSize"), source.naturalWidth, source.naturalHeight);
    function resize(width: number, height: number) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > Math.min(maxTextureSize, maxViewport[0]!) || height > Math.min(maxTextureSize, maxViewport[1]!)) throw new Error("图片尺寸超出当前设备调色上限，请先缩小图片");
      canvas.width = width;
      canvas.height = height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // 按实际显示尺寸高质量缩采样，避免大纹理直接缩小到节点时产生锯齿。
      if (width !== source.naturalWidth || height !== source.naturalHeight) {
        const preview = document.createElement("canvas");
        preview.width = width;
        preview.height = height;
        const context = preview.getContext("2d");
        if (!context) throw new Error("无法创建调色预览");
        context.imageSmoothingQuality = "high";
        context.drawImage(source, 0, 0, width, height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, preview);
        preview.width = preview.height = 0;
      } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.viewport(0, 0, width, height);
    }
    resize(width, height);
    const uniforms = Object.fromEntries(["light", "ends", "color", "detail", "colorDenoise", "effects", "premultiplyOutput"].map(key => [key, gl.getUniformLocation(program!, key)]));
    const gaussianUniforms = Object.fromEntries(["image", "direction", "taps[0]", "tapCount", "unpremultiplyOutput"].map(key => [key, gl.getUniformLocation(gaussianProgram!, key)]));

    function prepareBlurTargets() {
      if (blurWidth === canvas.width && blurHeight === canvas.height) return;
      while (blurTargets.length < 2) {
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        if (!texture || !framebuffer) {
          gl.deleteTexture(texture);
          gl.deleteFramebuffer(framebuffer);
          throw new Error("图片模糊内存不足");
        }
        blurTargets.push({ texture, framebuffer });
      }
      for (const target of blurTargets) {
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("当前设备无法创建图片模糊缓冲区");
      }
      blurWidth = canvas.width;
      blurHeight = canvas.height;
    }

    return {
      render(settings: ColorSettings) {
        if (gl.isContextLost()) throw new Error("调色预览已中断，请关闭调色后重新打开");
        for (const section of colorSections) for (const control of section.controls) {
          const value = settings[control.key];
          if (!Number.isFinite(value) || value < control.min || value > 100) throw new Error(`${control.label}参数无效`);
        }
        const s = settings;
        if (s.blur > 0) prepareBlurTargets();
        gl.useProgram(program);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.blur > 0 ? blurTargets[0]!.framebuffer : null);
        gl.uniform4f(uniforms.light!, s.exposure / 100, s.contrast / 100, s.highlights / 100, s.shadows / 100);
        gl.uniform2f(uniforms.ends!, s.whites / 100, s.blacks / 100);
        gl.uniform4f(uniforms.color!, s.temperature / 100, s.tint / 100, s.vibrance / 100, s.saturation / 100);
        gl.uniform4f(uniforms.detail!, s.texture / 100, s.clarity / 100, s.sharpen / 100, s.denoise / 100);
        gl.uniform1f(uniforms.colorDenoise!, s.colorDenoise / 100);
        gl.uniform4f(uniforms.effects!, s.dehaze / 100, s.vignette / 100, s.grain / 100, s.fade / 100);
        gl.uniform1i(uniforms.premultiplyOutput!, s.blur > 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (s.blur > 0) {
          gl.useProgram(gaussianProgram);
          gl.uniform1i(gaussianUniforms.image!, 0);
          for (let axis = 0; axis < 2; axis++) {
            const size = axis === 0 ? canvas.width : canvas.height;
            const originalSize = axis === 0 ? source.naturalWidth : source.naturalHeight;
            const { taps, count } = gaussianTaps(s.blur * 0.22 * size / originalSize);
            gl.uniform2fv(gaussianUniforms["taps[0]"]!, taps);
            gl.uniform1i(gaussianUniforms.tapCount!, count);
            gl.uniform2f(gaussianUniforms.direction!, axis === 0 ? 1 / size : 0, axis === 1 ? 1 / size : 0);
            gl.uniform1i(gaussianUniforms.unpremultiplyOutput!, axis);
            gl.bindTexture(gl.TEXTURE_2D, blurTargets[axis]!.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, axis === 0 ? blurTargets[1]!.framebuffer : null);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error("图片调色渲染失败，当前设备可能没有足够的图形内存");
      },
      resize, dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
