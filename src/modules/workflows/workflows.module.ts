import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SettingsModule } from '../settings/settings.module';
import { BillingModule } from '../billing/billing.module';
import { LeadsModule } from '../leads/leads.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowWebhookController } from './workflow-webhook.controller';
import { WorkflowValidator } from './workflow-validator.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { AiWorkflowGeneratorService } from './ai-workflow-generator.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowTriggerService } from './workflow-trigger.service';
import { WorkflowScheduleService } from './workflow-schedule.service';
import { TriggerNodeExecutor } from './nodes/trigger-node.executor';
import { ConditionNodeExecutor } from './nodes/condition-node.executor';
import { ApiNodeExecutor } from './nodes/api-node.executor';
import { AiNodeExecutor } from './nodes/ai-node.executor';
import { SendMessageNodeExecutor } from './nodes/send-message-node.executor';
import { CollectInputNodeExecutor } from './nodes/collect-input-node.executor';
import { SaveLeadNodeExecutor } from './nodes/save-lead-node.executor';
import { DelayNodeExecutor } from './nodes/delay-node.executor';
// Phase 5: Interactive Message Services
import { InteractiveMessageNodeExecutor } from './nodes/interactive-message-node.executor';
import { UserStateService } from './user-state.service';
import { InteractiveMessageHandlerService } from './interactive-message-handler.service';
import { WorkflowValidationInteractiveService } from './workflow-validation-interactive.service';

@Module({
  imports: [IntegrationsModule, SettingsModule, BillingModule, LeadsModule],
  controllers: [
    WorkflowsController,
    WorkflowWebhookController,
  ],
  providers: [
    WorkflowValidator,
    WorkflowTemplateService,
    AiWorkflowGeneratorService,
    WorkflowExecutionService,
    WorkflowTriggerService,
    WorkflowScheduleService,
    TriggerNodeExecutor,
    ConditionNodeExecutor,
    ApiNodeExecutor,
    AiNodeExecutor,
    SendMessageNodeExecutor,
    CollectInputNodeExecutor,
    SaveLeadNodeExecutor,
    DelayNodeExecutor,
    // Phase 5: Interactive Message Services
    InteractiveMessageNodeExecutor,
    UserStateService,
    InteractiveMessageHandlerService,
    WorkflowValidationInteractiveService,
  ],
  exports: [
    WorkflowValidator,
    WorkflowTemplateService,
    WorkflowExecutionService,
    WorkflowScheduleService,
    // Phase 5: Export new services
    UserStateService,
    InteractiveMessageHandlerService,
    WorkflowValidationInteractiveService,
  ],
})
export class WorkflowsModule {}
