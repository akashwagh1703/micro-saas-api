import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SettingsModule } from '../settings/settings.module';
import { BillingModule } from '../billing/billing.module';
import { LeadsModule } from '../leads/leads.module';
import { AvailabilityModule } from '../availability/availability.module';
import { InboxModule } from '../inbox/inbox.module';
import { CatalogModule } from '../catalog/catalog.module';
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
import { ListResourcesNodeExecutor } from './nodes/list-resources-node.executor';
import { ListSlotsNodeExecutor } from './nodes/list-slots-node.executor';
import { BookSlotNodeExecutor } from './nodes/book-slot-node.executor';
import { PickOptionsNodeExecutor } from './nodes/pick-options-node.executor';
// Phase 5: Interactive Message Services
import { InteractiveMessageNodeExecutor } from './nodes/interactive-message-node.executor';
import { UserStateService } from './user-state.service';
import { InteractiveMessageHandlerService } from './interactive-message-handler.service';
import { WorkflowValidationInteractiveService } from './workflow-validation-interactive.service';
import { WorkflowInteractiveSendService } from './workflow-interactive-send.service';

@Module({
  imports: [
    IntegrationsModule,
    SettingsModule,
    BillingModule,
    LeadsModule,
    AvailabilityModule,
    InboxModule,
    CatalogModule,
  ],
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
    ListResourcesNodeExecutor,
    ListSlotsNodeExecutor,
    BookSlotNodeExecutor,
    PickOptionsNodeExecutor,
    // Phase 5: Interactive Message Services
    InteractiveMessageNodeExecutor,
    UserStateService,
    InteractiveMessageHandlerService,
    WorkflowValidationInteractiveService,
    WorkflowInteractiveSendService,
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
    WorkflowInteractiveSendService,
  ],
})
export class WorkflowsModule {}
