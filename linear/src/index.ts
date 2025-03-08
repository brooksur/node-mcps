import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LinearClient } from '@linear/sdk'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import { z } from 'zod'

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from one directory up from the current file
dotenv.config({
  path: path.resolve(__dirname, '..', '.env')
})

// Validate required environment variables
if (!process.env.LINEAR_API_KEY) {
  throw new Error('LINEAR_API_KEY environment variable is required')
}

const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY
})

// Create server instance
const server = new McpServer({
  name: 'linear',
  version: '1.0.0'
})

server.resource('teams', 'linear://teams', async (uri) => {
  try {
    const teams = await linearClient.teams()

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(teams, null, 2)
        }
      ]
    }
  } catch (error) {
    console.error('Error fetching teams:', error)
    return {
      contents: [
        {
          uri: uri.href,
          text: `Error fetching teams: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        }
      ]
    }
  }
})

server.tool(
  'create-issue',
  'Create a new issue for a team in Linear',
  {
    teamId: z.string().describe('The ID of the team to create the issue in'),
    title: z.string().describe('The title of the issue'),
    description: z.string().describe('The description of the issue'),
    priority: z
      .number()
      .describe('The priority of the issue (0-4, 4 is highest)')
  },
  async ({ teamId, title, description, priority }) => {
    try {
      const issue = await linearClient.createIssue({
        teamId,
        title,
        description,
        priority
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(issue) }]
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify(error) }]
      }
    }
  }
)

server.prompt(
  'create-task-template',
  'Template for creating a new task in Linear according to team standards',
  {
    teamId: z.string().describe('The ID of the team to create the issue in'),
    title: z.string().describe('The title of the issue'),
    description: z
      .string()
      .optional()
      .describe('Initial description of the issue')
  },
  async ({ teamId, title, description = '' }) => {
    try {
      // Get the team details to personalize the prompt
      const teamResponse = await linearClient.team(teamId)
      const team = teamResponse || { name: 'Unknown Team' }

      // Get team workflow states
      const statesResponse = await linearClient.workflowStates({
        filter: {
          team: {
            id: {
              eq: teamId
            }
          }
        }
      })

      const states = statesResponse.nodes.map((state) => ({
        id: state.id,
        name: state.name
      }))

      // Get team members for assignment options
      const membersResponse = await linearClient.users()
      const members = membersResponse.nodes.map((user) => ({
        id: user.id,
        name: user.name || user.displayName || 'Unknown User'
      }))

      // Create the prompt message
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I need to create a new issue in the ${team.name} team.

Issue Title: ${title}
${description ? `Initial Description: ${description}\n` : ''}

Please help me fill out the task details according to our team standards:

1. Description: The description should include:
   - Background context
   - Goals or objectives
   - Acceptance criteria
   - Any dependencies

2. Priority: We use these priority levels:
   - 0: No priority
   - 1: Urgent (Must be done immediately)
   - 2: High (Should be done soon)
   - 3: Medium (Should be done)
   - 4: Low (Nice to have)

3. Assignment: Available team members:
${members.map((member) => `   - ${member.name} (ID: ${member.id})`).join('\n')}

4. Workflow State: Available states:
${states.map((state) => `   - ${state.name} (ID: ${state.id})`).join('\n')}

Please ask me questions to fill in these details, then help me create the issue using the create-issue tool.`
            }
          }
        ]
      }
    } catch (error) {
      console.error('Error creating task template:', error)
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I wanted to create a new task for team ID "${teamId}" but encountered an error: ${
                error instanceof Error ? error.message : 'Unknown error'
              }.

Please check that the team ID is valid and try again. You can get a list of valid teams using the linear://teams resource.`
            }
          }
        ]
      }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.log('Linear MCP Server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
