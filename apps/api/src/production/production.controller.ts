import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { STATION_ORDER } from '../domain/stations';
import { CreateManagementEventDto, ProductionQueryDto } from '../sources/dto';
import { ProductionService } from './production.service';

@ApiTags('production')
@Controller()
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('lines')
  @ApiOperation({ summary: 'Production status by line and station' })
  getLines(@Query() query: ProductionQueryDto) {
    return this.production.getLines(query);
  }

  @Get('batches')
  @ApiOperation({ summary: 'Every batch with its derived state and indicators' })
  listBatches(@Query() query: ProductionQueryDto) {
    return this.production.listBatches(query);
  }

  @Get('batches/:batchId')
  @ApiOperation({ summary: 'One batch with its full timeline and provenance' })
  getBatch(@Param('batchId') batchId: string, @Query() query: ProductionQueryDto) {
    return this.production.getBatch(batchId, query);
  }

  @Get('batches/:batchId/events')
  listManagementEvents(@Param('batchId') batchId: string) {
    return this.production.listManagementEvents(batchId);
  }

  @Post('batches/:batchId/events')
  @ApiOperation({ summary: 'Acknowledge, block, resume or annotate a batch' })
  addManagementEvent(@Param('batchId') batchId: string, @Body() dto: CreateManagementEventDto) {
    return this.production.addManagementEvent(batchId, dto);
  }

  @Get('stations')
  @ApiOperation({ summary: 'The six process steps, in order' })
  getStations() {
    return { stations: STATION_ORDER };
  }
}
