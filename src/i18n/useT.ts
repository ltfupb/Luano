import { useSettingsStore } from "../stores/settingsStore"
import { translations, Lang, TranslationKey } from "./translations"

export function useT(): (key: TranslationKey) => string {
  const { language } = useSettingsStore()
  const lang = (language as Lang) in translations ? (language as Lang) : "en"
  return (key: TranslationKey) => translations[lang][key] ?? translations.en[key]
}
