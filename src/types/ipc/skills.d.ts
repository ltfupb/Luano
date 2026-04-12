interface SkillsApi {
  skillsLoad: (projectPath: string) => Promise<unknown[]>
  skillsSave: (projectPath: string, skills: unknown[]) => Promise<{ success: boolean }>
}
