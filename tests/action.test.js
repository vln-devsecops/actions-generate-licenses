const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('GitHub Action Configuration', () => {
  let actionConfig;

  beforeAll(() => {
    const actionPath = path.join(__dirname, '../action.yml');
    actionConfig = yaml.load(fs.readFileSync(actionPath, 'utf8'));
  });

  it('declares the expected inputs and defaults', () => {
    expect(actionConfig.name).toBeDefined();
    expect(actionConfig.description).toBeDefined();
    expect(actionConfig.runs.using).toBe('composite');

    expect(actionConfig.inputs['working-directory']).toEqual(
      expect.objectContaining({ required: true })
    );
    expect(actionConfig.inputs['node-version']).toEqual(
      expect.objectContaining({ default: '22' })
    );
    expect(actionConfig.inputs['fail-on-unknown']).toEqual(
      expect.objectContaining({ default: 'false' })
    );
    expect(actionConfig.inputs['fail-on-copyleft']).toEqual(
      expect.objectContaining({ default: 'false' })
    );
    expect(actionConfig.inputs['fail-on-missing-licenses']).toEqual(
      expect.objectContaining({ default: 'true' })
    );
  });

  it('wires each script step to the bundled dist entry points', () => {
    const stepsByName = Object.fromEntries(
      actionConfig.runs.steps.map((step) => [step.name, step])
    );

    expect(stepsByName['Generate licenses CSV']).toEqual(
      expect.objectContaining({
        shell: 'bash',
        run: 'node ${{ github.action_path }}/dist/csv/index.cjs',
      })
    );
    expect(stepsByName['Download license files']).toEqual(
      expect.objectContaining({
        shell: 'bash',
        run: 'node ${{ github.action_path }}/dist/download/index.cjs',
      })
    );
    expect(stepsByName['Generate licenses HTML']).toEqual(
      expect.objectContaining({
        shell: 'bash',
        run: 'node ${{ github.action_path }}/dist/html/index.cjs',
      })
    );
  });

  it('passes the expected environment and caching configuration to action steps', () => {
    const stepsByName = Object.fromEntries(
      actionConfig.runs.steps.map((step) => [step.name, step])
    );

    expect(stepsByName['Restore cached license files']).toEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/cache@v\d+$/),
        with: expect.objectContaining({
          key: 'licenses-${{ steps.cache-key.outputs.csv-hash }}',
        }),
      })
    );
    expect(stepsByName['Generate licenses CSV'].env).toEqual(
      expect.objectContaining({
        FAIL_ON_UNKNOWN: '${{ inputs.fail-on-unknown }}',
        FAIL_ON_COPYLEFT: '${{ inputs.fail-on-copyleft }}',
        PRODUCTION_ONLY: '${{ inputs.production-only }}',
      })
    );
    expect(stepsByName['Download license files'].env).toEqual(
      expect.objectContaining({
        FAIL_ON_MISSING_LICENSES: '${{ inputs.fail-on-missing-licenses }}',
      })
    );
  });
});
