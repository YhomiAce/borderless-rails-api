import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CreateWalletDto, WalletIdParamDto } from './wallets.schemas';
import { presentWallet } from './wallets.presenter';
import { WalletsService } from './wallets.service';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateWalletDto) {
    return presentWallet(await this.wallets.create(body));
  }

  @Get(':walletId')
  async findOne(@Param() { walletId }: WalletIdParamDto) {
    return presentWallet(await this.wallets.findById(walletId));
  }
}
