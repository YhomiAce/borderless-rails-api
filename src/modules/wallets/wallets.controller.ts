import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/openapi/error.schema';
import { WalletResponseDto } from './wallets.responses';
import { CreateWalletDto, WalletIdParamDto } from './wallets.schemas';
import { presentWallet } from './wallets.presenter';
import { WalletsService } from './wallets.service';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a wallet',
    description:
      'Identified by email and/or phone; each can belong to only one wallet. Starts with a zero balance in every supported stablecoin.',
  })
  @ApiCreatedResponse({ type: WalletResponseDto.Output })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  async create(@Body() body: CreateWalletDto) {
    return presentWallet(await this.wallets.create(body));
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Get a wallet with all balances and their total in USD' })
  @ApiOkResponse({ type: WalletResponseDto.Output })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async findOne(@Param() { walletId }: WalletIdParamDto) {
    return presentWallet(await this.wallets.findById(walletId));
  }
}
