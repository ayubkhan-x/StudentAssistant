require('dotenv').config()
const { Telegraf } = require('telegraf')
const fs = require('fs')
const path = require('path')

const bot = new Telegraf(process.env.BOT_TOKEN)
const teacherChatId = process.env.TEACHER_CHAT_ID
const studentsFilePath = path.join(__dirname, 'students.json')

// Load students from JSON file
const loadStudents = () => {
	if (fs.existsSync(studentsFilePath)) {
		const data = fs.readFileSync(studentsFilePath)
		return JSON.parse(data)
	}
	return { students: [], nextId: 1 }
}

// Save students to JSON file
const saveStudents = data => {
	fs.writeFileSync(studentsFilePath, JSON.stringify(data, null, 2))
}

let { students, nextId } = loadStudents()
let studentSession = {} // To track active sessions

// Handle /start command for registration and teacher greetings
bot.start(async ctx => {
	const userId = ctx.from.id
	const student = students.find(s => s.userId === userId)

	if (userId.toString() === teacherChatId) {
		ctx.reply('Welcome, teacher! Use /help to see available commands. 📚')
	} else if (student) {
		ctx.reply(
			`You are already registered as ${student.name} ${student.surname} from group ${student.group}. Use the /edit command to update your information.`
		)
	} else {
		ctx.reply(
			'Please enter your full name, group name, and time (e.g., John Doe Intensive IELTS 18:00):'
		)
	}
})

// Display available commands
bot.command('help', ctx => {
	if (ctx.from.id.toString() === teacherChatId) {
		ctx.reply(`
Commands:
/students - Show the list of all students
/send_all - Send a message to all students
/send - Send a message to a specific student
/send_group - Send a message to a specific group
        `)
	} else {
		ctx.reply(`
Commands:
/check - Check your own details
/edit - Edit your own information
/submit - Submit your assignment (text or photo only)
        `)
	}
})

// Display student details
bot.command('students', ctx => {
	if (ctx.from.id.toString() === teacherChatId) {
		if (students.length === 0) {
			ctx.reply('No students registered yet.')
			return
		}

		const groups = students.reduce((acc, student) => {
			if (!acc[student.group]) {
				acc[student.group] = []
			}
			acc[student.group].push(student)
			return acc
		}, {})

		let message = 'Registered Students:\n\n'

		for (const [group, groupStudents] of Object.entries(groups)) {
			message += `Group: ${group}\n`
			groupStudents.forEach(student => {
				message += `ID: ${student.id} | Name: ${student.name} ${student.surname}\n`
			})
			message += '\n'
		}

		// Check if message length is too long and split if necessary
		const maxMessageLength = 4096 // Max length of a message in Telegram
		if (message.length > maxMessageLength) {
			const chunks = message.match(
				new RegExp('.{1,' + maxMessageLength + '}', 'g')
			)
			chunks.forEach(chunk => ctx.reply(chunk))
		} else {
			ctx.reply(message)
		}
	} else {
		ctx.reply('You are not authorized to use this command.')
	}
})

// Handle /send_group command
bot.command('send_group', async ctx => {
	const userId = ctx.from.id

	if (userId.toString() === teacherChatId) {
		ctx.reply(
			'Please enter the group name and time (e.g., Intensive IELTS 18:00):'
		)
		studentSession[userId] = { type: 'SEND_GROUP' }
	} else {
		ctx.reply('You are not authorized to use this command.')
	}
})

// Handle text commands from teacher
bot.on('text', async ctx => {
	const message = ctx.message.text
	const userId = ctx.from.id

	if (userId.toString() === teacherChatId) {
		if (message.startsWith('/send_all')) {
			ctx.reply('Please enter the message to send to all students:')
			studentSession[userId] = { type: 'SEND_ALL' }
		} else if (message.startsWith('/send')) {
			ctx.reply('Please enter the student ID to send a message to:')
			studentSession[userId] = { type: 'SEND_SINGLE' }
		} else if (studentSession[userId]) {
			const session = studentSession[userId]
			const text = message

			if (session.type === 'SEND_ALL') {
				students.forEach(student => {
					bot.telegram.sendMessage(student.userId, text)
				})
				ctx.reply('Message sent to all students.')
				delete studentSession[userId]
			} else if (session.type === 'SEND_SINGLE') {
				const studentId = parseInt(message, 10)
				const student = students.find(student => student.id === studentId)
				if (student) {
					ctx.reply(
						`Student selected: ${student.name} ${student.surname}. Enter the message to send:`
					)
					studentSession[userId] = { type: 'SEND_SINGLE_MESSAGE', studentId }
				} else {
					ctx.reply('Invalid student ID.')
					delete studentSession[userId]
				}
			} else if (session.type === 'SEND_SINGLE_MESSAGE') {
				const studentId = session.studentId
				const student = students.find(s => s.id === studentId)
				if (student) {
					bot.telegram.sendMessage(student.userId, text)
					ctx.reply('Message sent to the student.')
				} else {
					ctx.reply('Invalid student ID.')
				}
				delete studentSession[userId]
			} else if (session.type === 'SEND_GROUP') {
				const group = text.trim()

				if (group) {
					const groupStudents = students.filter(
						student => student.group === group
					)
					if (groupStudents.length > 0) {
						ctx.reply(`You can now write your message to group ${group}:`)
						studentSession[userId] = { type: 'SEND_GROUP_MESSAGE', group }
					} else {
						ctx.reply('Group not found. Please try again.')
					}
				} else {
					ctx.reply('Invalid group format. Please try again.')
				}
			} else if (session.type === 'SEND_GROUP_MESSAGE') {
				const { group } = session
				const groupStudents = students.filter(
					student => student.group === group
				)
				groupStudents.forEach(student => {
					bot.telegram.sendMessage(student.userId, text)
				})
				ctx.reply(`Message sent to group ${group}.`)
				delete studentSession[userId]
			}
		}
	} else {
		const student = students.find(s => s.userId === userId)

		if (!student) {
			const [name, surname, ...groupArray] = message.split(' ')
			const group = groupArray.join(' ')

			if (name && surname && group) {
				const id = nextId++
				students.push({ id, userId, name, surname, group })
				saveStudents({ students, nextId })
				ctx.reply(
					`You are registered as ${name} ${surname} from group ${group} with ID: ${id}`
				)
				bot.telegram.sendMessage(
					teacherChatId,
					`New student registered: ${name} ${surname}, group ${group}, ID: ${id}`
				)
			} else {
				ctx.reply('Please enter valid details: full name and group.')
			}
		} else if (message.startsWith('/edit')) {
			ctx.reply(
				'Please enter the new details (e.g., Jane Doe Intensive IELTS 19:00):'
			)
			studentSession[userId] = { type: 'EDIT' }
		} else if (message.startsWith('/check')) {
			ctx.reply(
				`Your details are:\nName: ${student.name}\nSurname: ${student.surname}\nGroup: ${student.group}`
			)
		} else if (message.startsWith('/submit')) {
			ctx.reply('Please send your assignment (text or photo) now.')
			studentSession[userId] = { type: 'SUBMIT' }
		} else if (
			studentSession[userId] &&
			studentSession[userId].type === 'EDIT'
		) {
			const [name, surname, ...groupArray] = message.split(' ')
			const group = groupArray.join(' ')
			const studentIndex = students.findIndex(s => s.userId === userId)

			if (name && surname && group && studentIndex !== -1) {
				students[studentIndex] = {
					...students[studentIndex],
					name,
					surname,
					group,
				}
				saveStudents({ students, nextId })
				ctx.reply(
					`Your details have been updated to: ${name} ${surname} from group ${group}`
				)
				bot.telegram.sendMessage(
					teacherChatId,
					`Student updated: ${name} ${surname} from group ${group}`
				)
				delete studentSession[userId]
			} else {
				ctx.reply('Please enter valid details: full name and group.')
			}
		} else if (
			studentSession[userId] &&
			studentSession[userId].type === 'SUBMIT'
		) {
			const assignmentText = message

			if (assignmentText) {
				const submitMessage = `Student ${student.name} ${student.surname} from group ${student.group} submitted an assignment (text):\n\n${assignmentText}`
				await ctx.telegram.sendMessage(teacherChatId, submitMessage)
				ctx.reply('Your assignment text has been sent to the teacher.')
				delete studentSession[userId]
			} else {
				ctx.reply(
					'Please register with the /start command and provide your details.'
				)
			}
		}
	}
})

// Handle assignment submissions (text, photos, documents, etc.)
bot.on(
	['photo', 'document', 'video', 'audio', 'voice', 'sticker', 'text'],
	async ctx => {
		const userId = ctx.from.id
		const student = students.find(s => s.userId === userId)

		if (student) {
			if (studentSession[userId] && studentSession[userId].type === 'SUBMIT') {
				let fileType = ''
				let messageText = ''

				if (ctx.message.text) {
					fileType = 'text'
					messageText = ctx.message.text
					const submitMessage = `Student ${student.name} ${student.surname} from group ${student.group} submitted an assignment (text):\n\n${messageText}`
					await ctx.telegram.sendMessage(teacherChatId, submitMessage)
					ctx.reply('Your assignment text has been sent to the teacher.')
				} else if (ctx.message.photo) {
					fileType = 'photo'
					const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id
					const file = await bot.telegram.getFile(fileId)
					const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
					const submitMessage = `Student ${student.name} ${student.surname} from group ${student.group} submitted an assignment (photo):\n\n${fileUrl}`
					await ctx.telegram.sendMessage(teacherChatId, submitMessage)
					ctx.reply('Your assignment photo has been sent to the teacher.')
				}

				delete studentSession[userId]
			} else {
				ctx.reply(
					'You are not in a submission session. Please use /submit to start submitting.'
				)
			}
		} else {
			ctx.reply(
				'Please register with the /start command and provide your details.'
			)
		}
	}
)

bot.launch()
console.log('Bot is running')
