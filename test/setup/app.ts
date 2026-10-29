import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export async function createTestApp(
  customise: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication> {
  const moduleRef = await customise(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return app;
}
