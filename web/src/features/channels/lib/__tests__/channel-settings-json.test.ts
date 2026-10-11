/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformFormDataToCreatePayload,
  type ChannelFormValues,
} from '../channel-form'

function awsChannelForm(settings: string): ChannelFormValues {
  return {
    ...CHANNEL_FORM_DEFAULT_VALUES,
    name: 'aws-bedrock',
    type: 33,
    key: 'ak|sk|us-east-1',
    models: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
    settings,
  }
}

function settingsFromPayload(form: ChannelFormValues): Record<string, unknown> {
  const payload = transformFormDataToCreatePayload(form)
  return JSON.parse(payload.channel.settings ?? '{}')
}

describe('channel settings JSON', () => {
  test('does not write aws_key_type for an AWS channel', () => {
    expect(settingsFromPayload(awsChannelForm('{}'))).not.toHaveProperty(
      'aws_key_type'
    )
  })

  test('removes a legacy aws_key_type and keeps the other stored settings', () => {
    const settings = settingsFromPayload(
      awsChannelForm(
        '{"aws_key_type":"api_key","upstream_model_update_last_check_time":123}'
      )
    )

    expect(settings).not.toHaveProperty('aws_key_type')
    expect(settings.upstream_model_update_last_check_time).toBe(123)
  })
})
