import type { ProfileRecord, Workflow } from "../api/types";
import type { ProfileWorkflowSettings } from "../state/skinSettings";

export function workflowForSelectedProfile(workflow: Workflow, profile: ProfileRecord, settings?: ProfileWorkflowSettings): Workflow {
  const extras = workflow.context?.extras ?? {};
  const workflowSkin = extras.workflowSkin && typeof extras.workflowSkin === "object" && !Array.isArray(extras.workflowSkin) ? extras.workflowSkin : {};
  return {
    profile: profile.profile,
    context: {
      ...workflow.context,
      ...(settings?.brewRecipe ? { targetDoseWeight: settings.brewRecipe.dose, targetYield: settings.brewRecipe.yield } : {}),
      extras: { ...extras, workflowSkin: { ...workflowSkin, selectedProfileId: profile.id } }
    }
  };
}
