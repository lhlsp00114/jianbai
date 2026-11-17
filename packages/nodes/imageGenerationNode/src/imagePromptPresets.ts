import { panoramaPromptPresets, readPanoramaPromptInstruction } from "@toonflow/node-image/panoramaPrompt";
import { IconBooks, IconMovie, IconLayoutGrid, IconClockPlus, IconClockMinus, IconUserCircle, IconPhotoEdit, IconCamera, IconUserScan, IconFaceId, IconUser, IconStack2, IconPackage, IconPanoramaHorizontal } from "@tabler/icons-vue";

export const imagePromptPresetColumns = [["分镜叙事", "质感调节"], ["空间与机位", "设定图"]] as const;

export const imagePromptPresets = [
  ...panoramaPromptPresets.map(preset => ({ ...preset, group: "空间与机位", icon: IconPanoramaHorizontal })),
  ...[
    {
      id: "blockingStoryboard",
      group: "分镜叙事",
      icon: IconBooks,
      label: "调度故事板",
      description: "展示人物走位与镜头调度",
      prompt: "根据参考图片和补充描述，生成一张包含六个连续镜头的调度故事板，按两行三列排列，阅读顺序从左到右、从上到下。用全景、中景和近景交代人物位置、行动路线、视线关系与镜头调度，遵守同一场景的空间关系和动作轴线。保持人物身份、服装、道具、光线与画风一致，镜头之间有清晰的动作衔接；画面中不添加文字、箭头或水印。",
    },
    {
      id: "storyboard",
      group: "分镜叙事",
      icon: IconMovie,
      label: "故事板",
      description: "将画面与描述整理成六格叙事",
      prompt: "根据参考图片和补充描述，生成一张两行三列的六格故事板。按从左到右、从上到下的顺序，依次呈现环境建立、人物状态、事件触发、行动发展、关键反应和收束镜头，形成完整且自然的短场景。保持角色身份、外貌、服装、场景、道具和视觉风格一致，合理变化景别与构图；不用文字代替叙事，不添加对白、字幕或水印。",
    },
    {
      id: "continuousStoryboard25",
      group: "分镜叙事",
      icon: IconMovie,
      label: "25宫格连贯分镜",
      description: "生成五行五列的连续分镜图",
      prompt: "以参考图片为视觉依据，结合补充描述，将同一段场景扩展为一张五行五列、恰好25格的连贯分镜图。按从左到右、从上到下的顺序推进剧情，围绕同一个主要事件安排建立、发展、转折和收束，避免重复同一画面。人物身份、服装、道具、环境和光线保持连贯，动作、视线与空间位置合理衔接，穿插远景、中景、近景和细节镜头。每格尺寸一致、边界清晰，不添加编号、文字、字幕或水印。",
    },
    {
      id: "storyProgression4",
      group: "分镜叙事",
      icon: IconLayoutGrid,
      label: "剧情推演四宫格",
      description: "围绕当前场景推进四个镜头",
      prompt: "根据参考图片和补充描述，生成一张两行两列的四宫格剧情推演图。第一格承接当前画面的状态，第二格展示随后发生的动作，第三格展示事件带来的变化或反应，第四格自然收束。按从左到右、从上到下阅读，保持同一人物、服装、环境、道具和画风一致，动作与空间关系连贯，不突然引入无关角色或场景，不添加文字、编号或水印。",
    },
    {
      id: "frameAfter3Seconds",
      group: "分镜叙事",
      icon: IconClockPlus,
      label: "画面推演 · 3秒后",
      description: "推演当前画面三秒后的状态",
      prompt: "将参考图片视为当前时刻，结合补充描述，推演同一场景约3秒后的一个合理瞬间，输出单张画面。延续人物当前的动作趋势、表情和视线，以及可见物体的运动方向，变化幅度符合3秒的时间跨度。保持人物身份、服装、道具、场景、镜头位置、光线和视觉风格一致，不凭空增加无关元素，不输出拼图、对比图、文字或水印。",
    },
    {
      id: "frameBefore5Seconds",
      group: "分镜叙事",
      icon: IconClockMinus,
      label: "画面推演 · 5秒前",
      description: "回推当前画面五秒前的状态",
      prompt: "将参考图片视为当前时刻，结合补充描述，回推同一场景约5秒前的一个合理瞬间，输出单张画面。依据人物姿态、动作方向、物体位置和环境线索，构造能够自然发展到参考画面的前置动作，避免无依据的大幅剧情变化。保持人物身份、服装、道具、场景、镜头位置、光线和视觉风格一致，不输出拼图、对比图、文字或水印。",
    },
    {
      id: "portraitTexture",
      group: "质感调节",
      icon: IconUserCircle,
      label: "人像质感调节",
      description: "改善肤质、发丝与服装细节",
      prompt: "在保留参考图片构图和人物身份的基础上，改善人像的自然质感。保持五官比例、年龄特征、表情、姿态、服装与背景不变，细化真实皮肤纹理、细微毛孔、发丝层次和衣料质感，让面部明暗与环境光协调。避免过度磨皮、塑料皮肤、锐化光晕、夸张美颜以及擅自改变脸型和身材；保留原图的摄影或绘画风格，不添加文字或水印。",
    },
    {
      id: "cinematicLighting",
      group: "质感调节",
      icon: IconPhotoEdit,
      label: "电影级光影校正",
      description: "优化光线层次与整体色彩",
      prompt: "对参考图片进行电影感的光影与色彩校正，保留原有主体、构图、姿态、场景和视觉风格。根据现有光源方向协调主光、环境光与阴影，改善高光过曝和暗部死黑，增加自然的明暗层次、色彩分离与空间纵深，保持肤色和材质可信。避免过度饱和、强烈HDR、无依据的光源和夸张光效，不添加物体、文字或水印。",
    },
    {
      id: "multiCamera9",
      group: "空间与机位",
      icon: IconCamera,
      label: "多机位九宫格",
      description: "从九个机位观察同一场景",
      prompt: "根据参考图片重建同一场景，输出一张三行三列的多机位九宫格图。九格依次采用正面、左前方、右前方、左侧、右侧、后方、低机位、高机位和局部特写，保持人物动作处于同一时刻。所有视角中的人物身份、服装、道具、材质、光线与空间关系一致，合理补全不可见区域，避免镜像替代机位变化。每格尺寸一致、构图清晰，不添加机位标注、文字或水印。",
    },
    {
      id: "characterThreeViews",
      group: "设定图",
      icon: IconUserScan,
      label: "角色三视图",
      description: "统一角色正面、侧面与背面",
      prompt: "依据参考图片中的主要角色，生成同一角色的全身三视图设定图，在一张图中从左到右排列正面、侧面、背面。三个人物站姿自然、比例和高度一致、脚底对齐，完整显示头部到脚部。严格保持角色身份、体型、发型、服装结构、配饰、材质、配色和原有画风一致，合理补全未显示部分。采用干净的中性背景与均匀照明，不加入透视夸张、无关道具、文字或水印。",
    },
    {
      id: "faceThreeViews",
      group: "设定图",
      icon: IconFaceId,
      label: "角色脸部三视图",
      description: "展示同一张脸的三个角度",
      prompt: "根据参考图片中的主要角色，生成一张脸部三视图设定图，从左到右展示正面、四分之三侧面和纯侧面头肩像。三个视角保持相同的脸部身份、骨相比例、眼睛、鼻子、嘴型、肤色、年龄、发型和表情，头部大小及眼睛高度尽量一致。采用统一的中性背景和柔和照明，保留原画风，不随角度改变人物长相，不添加文字或水印。",
    },
    {
      id: "characterDesign",
      group: "设定图",
      icon: IconUser,
      label: "角色设定图",
      description: "整理角色外形、表情与细节",
      prompt: "根据参考图片和补充描述，生成一张布局清晰的角色设定图。以主要角色的完整全身形象为视觉中心，周围安排同一角色的三个自然表情头部特写，以及服装、配饰或标志性道具的细节展示。各区域保持同一人物身份、外貌比例、服装设计、材质配色与视觉风格，采用干净的中性背景，避免内容重叠和无关装饰，不添加解释文字、编号或水印。",
    },
    {
      id: "sceneDesign",
      group: "设定图",
      icon: IconStack2,
      label: "场景设定图",
      description: "展示空间全貌与关键环境细节",
      prompt: "根据参考图片和补充描述，生成一张场景设定图。以能够说明空间结构的环境全景为主画面，辅以三个小幅细节视图，展示关键建筑或家具、材质细节与环境陈设。保持同一场景的空间布局、尺度、物件位置、材质、配色、光源和视觉风格一致，合理补全不可见区域，不擅自增加无关主体。版式清晰、区域不重叠，不添加标题、说明文字或水印。",
    },
    {
      id: "productDesign",
      group: "设定图",
      icon: IconPackage,
      label: "产品设定图",
      description: "呈现产品多视角与材质细节",
      prompt: "根据参考图片中的主要产品和补充描述，生成一张产品设定图。以产品四分之三视角为主画面，辅以正面、侧面、背面视图和一个关键结构或材质的近景。各视角保持同一产品的外形、尺寸比例、结构、配件、材质、配色及已有标识一致，不虚构额外功能或零件。采用干净的中性背景和统一的柔和照明，排版清晰，不新增宣传文案、尺寸标注或水印。",
    },
  ].map(preset => ({ ...preset, value: `{{preset ${preset.id}}}` })),
];

export function readImagePresetPrompt(stores: unknown, id: string): string {
  const preset = imagePromptPresets.find(item => item.id === id);
  if (!preset) throw new Error("未知的内置提示词");
  if ("mode" in preset) return readPanoramaPromptInstruction(stores, preset.mode);
  if (stores === undefined) return preset.prompt;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) throw new Error("内置提示词设置格式错误");
  const instructions = (stores as Record<string, unknown>).nodeInstructions;
  if (instructions === undefined) return preset.prompt;
  if (!instructions || typeof instructions !== "object" || Array.isArray(instructions)) throw new Error("内置提示词设置格式错误");
  const value = (instructions as Record<string, unknown>)[id];
  if (value === undefined) return preset.prompt;
  if (typeof value !== "string" || !value.trim() || value.length > 16000) throw new Error("内置提示词必须是 1–16000 字符的非空文本");
  return value;
}
