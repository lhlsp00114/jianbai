import { computed, ref, watchEffect } from "vue";
import { adaptivePrimaryColor, uiSettings } from "@/stores/settings";

const systemDark = ref(false);
export const appearanceDark = computed(() => uiSettings.value.theme === "system" ? systemDark.value : uiSettings.value.theme === "dark");
export const appearancePrimaryColor = computed(() => uiSettings.value.primaryColor === adaptivePrimaryColor
  ? appearanceDark.value ? "#ffffff" : "#000000"
  : uiSettings.value.primaryColor);

export function registerAppearance() {
  const hostWindow = window as Window & {
    __electrobunSendToHost?: (message: { type: "appearance"; dark: boolean; backgroundColor: string; textColor: string }) => void;
  };
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  systemDark.value = systemTheme.matches;
  const updateSystemTheme = (event: MediaQueryListEvent) => { systemDark.value = event.matches; };
  systemTheme.addEventListener("change", updateSystemTheme);
  const stop = watchEffect(() => {
    const { primaryColor: primaryColorSetting, fontScale, radius } = uiSettings.value;
    const dark = appearanceDark.value;
    const primaryColor = appearancePrimaryColor.value;
    const adaptive = primaryColorSetting === adaptivePrimaryColor;
    const primaryForeground = adaptive && dark ? "#000" : "#fff";
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.setAttribute("theme-mode", dark ? "dark" : "light");
    root.style.colorScheme = dark ? "dark" : "light";
    root.style.fontSize = `${(16 * fontScale) / 100}px`;
    root.style.setProperty("--ui-radius", `${radius}px`);
    root.style.setProperty("--el-color-primary", primaryColor);
    root.style.setProperty("--ui-primary-foreground", primaryForeground);
    for (let level = 1; level <= 9; level++) {
      root.style.setProperty(`--el-color-primary-light-${level}`,
        `color-mix(in srgb, ${primaryColor} ${100 - level * 10}%, ${dark ? "#141414" : "#fff"})`);
    }
    root.style.setProperty("--el-color-primary-dark-2", `color-mix(in srgb, ${primaryColor} 80%, ${adaptive ? primaryForeground : dark ? "#fff" : "#000"})`);
    if (window === window.top && hostWindow.__electrobunSendToHost) {
      const style = getComputedStyle(root);
      hostWindow.__electrobunSendToHost({
        type: "appearance",
        dark,
        backgroundColor: style.getPropertyValue("--el-bg-color").trim(),
        textColor: style.getPropertyValue("--el-text-color-primary").trim(),
      });
    }
  });
  return () => {
    stop();
    systemTheme.removeEventListener("change", updateSystemTheme);
  };
}
