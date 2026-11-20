export type CameraSettings = { enabled: boolean; camera: string; lens: string; focalLength: number; aperture: number };

export const cameraOptions = [
  { id: "neutral", label: "默认相机", detail: "自然、均衡的摄影质感，让主体与场景优先。", prompt: "自然均衡的摄影质感，保留真实材质与明暗层次", saturation: 1, warmth: 0 },
  { id: "alexa", label: "ARRI ALEXA 35", detail: "电影叙事方向：柔和高光、自然肤色、丰富暗部。", prompt: "参考 ARRI ALEXA 35 的电影摄影视觉，柔和高光过渡、自然肤色与有层次的暗部", saturation: .93, warmth: .04 },
  { id: "red", label: "RED V-RAPTOR", detail: "现代电影方向：清晰细节、鲜明层次与有力画面。", prompt: "参考 RED V-RAPTOR 的现代电影摄影视觉，清晰细节、鲜明层次与克制锐度", saturation: 1.05, warmth: 0 },
  { id: "blackmagic", label: "Blackmagic Cinema Camera", detail: "独立电影方向：柔和色彩、自然光与生活感。", prompt: "独立电影摄影质感，柔和色彩、自然光和生活化的材质细节", saturation: .9, warmth: .03 },
  { id: "mitchell", label: "Mitchell BNCR（米切尔）", detail: "经典电影方向：模拟胶片颗粒、厚实色彩与柔和细节。", prompt: "经典电影胶片视觉，细腻模拟颗粒、厚实色彩和柔和细节，避免数字锐化感", saturation: .88, warmth: .1 },
  { id: "hasselbladFilm", label: "Hasselblad 500C/M（哈苏）", detail: "中画幅胶片方向：细腻层次、温润色彩与从容画面。", prompt: "参考哈苏中画幅胶片摄影的视觉气质，温润色彩、细腻层次、轻微胶片颗粒", saturation: .94, warmth: .07 },
  { id: "hasselbladDigital", label: "Hasselblad X2D 100C（哈苏）", detail: "中画幅数码方向：细致材质、清透色彩与平滑过渡。", prompt: "参考哈苏中画幅数码摄影的视觉气质，细致材质、自然清透的色彩和平滑色调过渡", saturation: 1.02, warmth: .01 },
  { id: "gfx", label: "Fujifilm GFX（富士）", detail: "中画幅人像方向：柔和层次、自然色彩与细节。", prompt: "中画幅人像摄影气质，柔和层次、自然色彩、细致纹理与清晰主体", saturation: .97, warmth: .03 },
  { id: "leica", label: "Leica M（徕卡）", detail: "人文纪实方向：克制色彩、立体光影与现场感。", prompt: "人文纪实摄影气质，克制色彩、立体光影和自然的现场感", saturation: .9, warmth: .02 },
  { id: "canon", label: "Canon EOS（佳能）", detail: "商业人像方向：柔和肤色、温暖明亮、画面干净。", prompt: "商业人像摄影气质，柔和自然的肤色、温暖明亮的光线和干净画面", saturation: 1.03, warmth: .06 },
  { id: "nikon", label: "Nikon Z（尼康）", detail: "风光纪实方向：清晰纹理、自然对比与空间层次。", prompt: "风光与纪实摄影气质，清晰纹理、自然对比和丰富的空间层次", saturation: 1.06, warmth: 0 },
  { id: "sony", label: "Sony Alpha（索尼）", detail: "现代数码方向：清晰主体、干净暗部、通透画面。", prompt: "现代数码摄影气质，清晰主体、干净暗部和通透的画面层次", saturation: 1, warmth: 0 },
  { id: "pentax", label: "Pentax 67（宾得）", detail: "中画幅胶片参考：宽厚层次、柔和颗粒与沉静人像。", prompt: "中画幅胶片人像视觉，宽厚层次、柔和颗粒与沉静的画面气质", saturation: .93, warmth: .05 },
  { id: "mamiya", label: "Mamiya RZ67（玛米亚）", detail: "棚拍胶片参考：细腻肤色、平滑过渡与精致静物。", prompt: "中画幅棚拍胶片视觉，细腻肤色、平滑明暗过渡与精致静物质感", saturation: .96, warmth: .04 },
  { id: "leicaQ", label: "Leica Q（徕卡）", detail: "街头摄影参考：环境叙事、清晰主体与自然色彩。", prompt: "街头人文摄影视觉，突出环境叙事、清晰主体与自然克制的色彩", saturation: .95, warmth: .02 },
  { id: "fujiX", label: "Fujifilm X（富士）", detail: "日常胶片参考：柔和反差、轻盈色彩与生活气息。", prompt: "日常胶片模拟视觉，柔和反差、轻盈色彩与自然的生活气息", saturation: .92, warmth: .04 },
  { id: "venice", label: "Sony VENICE（索尼）", detail: "电影摄影参考：通透暗部、细腻光线与沉浸空间。", prompt: "现代电影摄影视觉，通透暗部、细腻光线层次与沉浸式空间", saturation: .96, warmth: .01 },
  { id: "cinemaEos", label: "Canon Cinema EOS（佳能）", detail: "电影人像参考：温暖肤色、柔和高光与清晰叙事。", prompt: "电影人像摄影视觉，温暖自然的肤色、柔和高光与清晰叙事", saturation: .98, warmth: .06 },
  { id: "lumix", label: "Panasonic LUMIX（松下）", detail: "自然纪实参考：均衡色彩、干净细节与真实材质。", prompt: "自然纪实摄影视觉，均衡色彩、干净细节与真实材质", saturation: 1, warmth: .02 },
  { id: "polaroid", label: "Polaroid（拍立得）", detail: "即时成像参考：柔和细节、褪色色彩与怀旧氛围。", prompt: "即时成像摄影视觉，柔和细节、轻微褪色与怀旧氛围，不添加相纸边框", saturation: .82, warmth: .12 },
];

export const focalLengths = [8, 10, 12, 14, 15, 16, 18, 20, 21, 24, 25, 28, 32, 35, 40, 45, 50, 55, 58, 65, 70, 75, 85, 90, 100, 105, 110, 120, 135, 150, 160, 180, 200, 240, 250, 280, 300, 350, 400, 500, 600, 800, 1000];
export const apertures = [.95, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 28, 32];
// 保留已有镜头标识，兼容画布中的摄影参数；镜头风格与焦距、光圈独立。
export const lensOptions = [
  { id: "auto", label: "默认镜头", detail: "自然、均衡的镜头表现。", prompt: "自然均衡的镜头表现" },
  { id: "ultraWide", label: "Zeiss Ultra Prime（蔡司）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Zeiss Ultra Prime 镜头系列的视觉风格" },
  { id: "widePrime", label: "Zeiss Master Prime（蔡司）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Zeiss Master Prime 镜头系列的视觉风格" },
  { id: "documentary", label: "ARRI Signature Prime（阿莱）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 ARRI Signature Prime 镜头系列的视觉风格" },
  { id: "standard", label: "Cooke S4/i（库克）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Cooke S4/i 镜头系列的视觉风格" },
  { id: "portrait", label: "Cooke S7/i（库克）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Cooke S7/i 镜头系列的视觉风格" },
  { id: "vintage", label: "Helios（赫利奥斯）", detail: "复古镜头视觉参考，可独立设置取景与景深。", prompt: "复古 Helios 镜头视觉，柔和微反差与克制的旋转焦外" },
  { id: "standardZoom", label: "Angénieux Optimo（安琴）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Angénieux Optimo 镜头系列的视觉风格" },
  { id: "telephoto", label: "Canon CN-E（佳能）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Canon CN-E 镜头系列的视觉风格" },
  { id: "superTelephoto", label: "Fujinon Premista（富士）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Fujinon Premista 镜头系列的视觉风格" },
  { id: "macro", label: "Laowa（老蛙）", detail: "参考该品牌镜头的细节表现，焦距与光圈单独选择。", prompt: "参考 Laowa 镜头的细节表现" },
  { id: "anamorphic", label: "Hawk Class-X（霍克）", detail: "变形镜头视觉参考，焦距与光圈单独选择。", prompt: "参考 Hawk Class-X 变形镜头视觉，背景虚化时呈现椭圆焦外，强光源下呈现克制横向眩光，不添加黑边" },
  { id: "fisheye", label: "Lensbaby（镜头宝贝）", detail: "创意镜头视觉参考，焦距与光圈单独选择。", prompt: "参考 Lensbaby 创意镜头的选择性焦点表现" },
  { id: "wide28", label: "Leica Summilux-C（徕卡）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Leica Summilux-C 镜头系列的视觉风格" },
  { id: "normal40", label: "Leica Summicron-C（徕卡）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Leica Summicron-C 镜头系列的视觉风格" },
  { id: "portrait135", label: "Sigma Cine（适马）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Sigma Cine 镜头系列的视觉风格" },
  { id: "wideZoom", label: "Zeiss Supreme Prime（蔡司）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Zeiss Supreme Prime 镜头系列的视觉风格" },
  { id: "travelZoom", label: "Tokina Vista（图丽）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 Tokina Vista 镜头系列的视觉风格" },
  { id: "macro65", label: "DZOFilm Vespid（东正）", detail: "参考该镜头系列的视觉风格，焦距与光圈单独选择。", prompt: "参考 DZOFilm Vespid 镜头系列的视觉风格" },
  { id: "extremeTelephoto", label: "Atlas Orion（阿特拉斯）", detail: "变形镜头视觉参考，焦距与光圈单独选择。", prompt: "参考 Atlas Orion 变形镜头视觉，椭圆焦外与克制横向眩光，不添加黑边" },
];

export const defaultCameraSettings: CameraSettings = { enabled: false, camera: "neutral", lens: "auto", focalLength: 50, aperture: 5.6 };
export const cameraPresets = [
  { id: "default", label: "默认", camera: "neutral", lens: "auto", focalLength: 50, aperture: 5.6 },
  { id: "environment", label: "环境人像", camera: "canon", lens: "documentary", focalLength: 35, aperture: 2.8 },
  { id: "portrait", label: "浅景深人像", camera: "hasselbladDigital", lens: "portrait", focalLength: 85, aperture: 1.4 },
  { id: "landscape", label: "建筑风光", camera: "nikon", lens: "ultraWide", focalLength: 20, aperture: 8 },
  { id: "macro", label: "微距细节", camera: "sony", lens: "macro", focalLength: 100, aperture: 8 },
  { id: "film", label: "复古胶片", camera: "hasselbladFilm", lens: "vintage", focalLength: 58, aperture: 2 },
  { id: "cinema", label: "电影叙事", camera: "alexa", lens: "anamorphic", focalLength: 50, aperture: 2.8 },
  { id: "telephoto", label: "远摄压缩", camera: "nikon", lens: "telephoto", focalLength: 135, aperture: 4 },
];

export function isCameraSettings(value: unknown): value is CameraSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as CameraSettings;
  const lens = lensOptions.find(item => item.id === settings.lens);
  return typeof settings.enabled === "boolean" && cameraOptions.some(item => item.id === settings.camera)
    && !!lens && focalLengths.includes(settings.focalLength) && apertures.includes(settings.aperture);
}

export function focalLengthDescription(value: number) {
  if (value < 24) return "超广角视角，展示广阔空间，近景夸张、纵深明显；适合建筑、室内与壮阔风光。";
  if (value < 35) return "广角视角，保留丰富环境与空间纵深；适合街景、旅行与环境人像。";
  if (value < 70) return "标准视角，自然地呈现主体比例与环境关系；适合日常、人文和静物。";
  if (value < 135) return "中长焦视角，突出主体与柔和背景；适合人像、特写和产品细节。";
  if (value < 300) return "长焦视角，取景范围较窄，以远机位强调背景压缩；适合舞台、远处人物与局部风景。";
  return "超长焦视角，聚焦远处细节与强烈的空间压缩；适合野生动物、远景与局部特写。";
}

export function apertureDescription(value: number) {
  if (value <= 1.4) return "超大光圈：极浅景深、强烈背景虚化，焦点应落在主体关键部位；适合柔美人像。";
  if (value <= 2.8) return "大光圈：主体清晰、背景柔和，突出主体与环境分离；适合人像、静物与细节。";
  if (value <= 5.6) return "中等光圈：平衡主体细节与背景辨识度；适合环境人像、街拍与日常场景。";
  if (value <= 11) return "小光圈：较深景深，保留前中后景细节；适合建筑、风光、群像与产品。";
  return "很小光圈：强调大范围清晰与纵深细节，避免夸张背景虚化；近距离拍摄仍可能有浅景深。";
}
