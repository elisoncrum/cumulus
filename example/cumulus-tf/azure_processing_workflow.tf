module "azure_processing_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "AzureProcessing"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/azure_processing_workflow.asl.json",
    {
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn,
      fake_processing_task_arn: module.cumulus.fake_processing_task.task_arn,
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      azure_processing_task_arn: module.cumulus.run_azure_function_task.task_arn,
      azure_processing_queue_url: var.azure_processing_queue_url,
      azure_processing_orchestrator_url: var.azure_processing_orchestrator_url,
      update_granules_cmr_metadata_file_links_task_arn: module.cumulus.update_granules_cmr_metadata_file_links_task.task_arn,
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn
    }
  )
}