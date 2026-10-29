import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { FX_PROVIDER } from '../../src/modules/fx/providers/fx-provider';
import { RatesService } from '../../src/modules/fx/rates.service';
import { FakeFxProvider } from './fake-fx-provider';

export interface TestApp {
  app: INestApplication;
  fx: FakeFxProvider;
  rates: RatesService;
}

/** Boots the real AppModule with the FX provider replaced by a fake (tests never hit the internet). */
export async function createTestApp(
  customise: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<TestApp> {
  const fx = new FakeFxProvider();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FX_PROVIDER)
    .useValue(fx);
  const moduleRef = await customise(builder).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return { app, fx, rates: app.get(RatesService) };
}
