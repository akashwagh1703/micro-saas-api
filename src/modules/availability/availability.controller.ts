import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { V4AvailabilityGuard } from '../../common/guards/v4-availability.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityService } from './availability.service';
import {
  CreateBookingDto,
  CreateResourceDto,
  SetResourceScheduleDto,
  UpdateBookingDto,
  UpdateResourceDto,
} from './dto/availability.dto';

@Controller('availability')
@UseGuards(TokenAuthGuard, V4AvailabilityGuard)
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('resources')
  listResources(@CurrentUser('id') userId: number) {
    return this.availability.listResources(userId);
  }

  @Post('resources')
  createResource(@CurrentUser('id') userId: number, @Body() dto: CreateResourceDto) {
    return this.availability.createResource(userId, dto);
  }

  @Patch('resources/:id')
  updateResource(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResourceDto,
  ) {
    return this.availability.updateResource(userId, id, dto);
  }

  @Put('resources/:id/schedule')
  setSchedule(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetResourceScheduleDto,
  ) {
    return this.availability.setSchedule(userId, id, dto.weekly_slots);
  }

  @Get('slots')
  getSlots(
    @CurrentUser('id') userId: number,
    @Query('date') date: string,
    @Query('resource_id') resourceIdRaw?: string,
  ) {
    const resourceId = resourceIdRaw ? Number(resourceIdRaw) : undefined;
    return this.availability.getSlots(
      userId,
      date,
      resourceId != null && !Number.isNaN(resourceId) ? resourceId : undefined,
    );
  }

  @Get('bookings')
  listBookings(
    @CurrentUser('id') userId: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.availability.listBookings(userId, from, to);
  }

  @Post('bookings')
  createBooking(@CurrentUser('id') userId: number, @Body() dto: CreateBookingDto) {
    return this.availability.createBooking(userId, dto);
  }

  @Patch('bookings/:id')
  updateBooking(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.availability.updateBookingStatus(userId, id, dto.status);
  }
}
