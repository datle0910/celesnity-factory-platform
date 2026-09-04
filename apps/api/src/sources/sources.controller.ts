import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListRecordsQueryDto, RegisterSourceDto, UpdateSelectionDto } from './dto';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Post()
  @ApiOperation({ summary: 'Register a source' })
  register(@Body() dto: RegisterSourceDto) {
    return this.sources.register(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List registered sources with their latest run' })
  list() {
    return this.sources.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sources.get(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sources.remove(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the source is reachable and usable' })
  test(@Param('id') id: string) {
    return this.sources.test(id);
  }

  @Get(':id/schema')
  @ApiOperation({ summary: 'Discover the datasets, tables or topics available' })
  discover(@Param('id') id: string) {
    return this.sources.discover(id);
  }

  @Patch(':id/selection')
  @ApiOperation({ summary: 'Choose what should be collected' })
  updateSelection(@Param('id') id: string, @Body() dto: UpdateSelectionDto) {
    return this.sources.updateSelection(id, dto);
  }

  @Post(':id/collect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a collection now' })
  collect(@Param('id') id: string) {
    return this.sources.collect(id);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Collection history for a source' })
  listRuns(@Param('id') id: string) {
    return this.sources.listRuns(id);
  }
}

@ApiTags('collection')
@Controller()
export class CollectionController {
  constructor(private readonly sources: SourcesService) {}

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Status, duration, counts and errors for one run' })
  getRun(@Param('runId') runId: string) {
    return this.sources.getRun(runId);
  }

  @Get('records')
  @ApiOperation({ summary: 'Preview normalised records with their provenance' })
  listRecords(@Query() query: ListRecordsQueryDto) {
    return this.sources.listRecords(query);
  }

  @Post('reconcile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rebuild every canonical event from stored observations' })
  reconcile() {
    return this.sources.reconcile();
  }
}
